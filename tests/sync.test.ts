import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import { createMed, restock } from '../src/db/repos/meds';
import { logDose, removeDose } from '../src/db/repos/doses';
import { eraseAll, exportBackup, importBackup } from '../src/db/repos/backup';
import { getSyncConfig, join, mergeSnapshot, startSync } from '../src/app/sync';
import { listPeople } from '../src/db/repos/people';
import { decodeInvite, encodeInvite, familyId, isFamilyKey, newFamilyKey, openSnapshot, sealSnapshot, SyncError, type Snapshot } from '../src/logic/sync';
import { recountStock } from '../src/logic/stock';
import type { Dose } from '../src/db/schema';
// @ts-expect-error plain JS worker
import relay from '../sync-relay/worker.js';

const base = {
  name: 'Stim', strength: 10, unit: 'mg', form: 'tablet', defaultAmount: 20,
  schedule: { type: 'interval' as const, intervalHours: 4 }, color: '#0B7A75', icon: 'pill',
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const snapshot = async (name: string): Promise<Snapshot> => {
  const b = await exportBackup({ includePhotos: false });
  delete b.tables.settings;
  return { ...b, kind: 'sync', device: { id: `${name}-device-id`, name } };
};
const dose = (o: Partial<Dose>): Dose => ({ id: crypto.randomUUID(), medicationId: 'm', takenAt: '', amount: 20, source: 'manual', createdAt: '', updatedAt: '', ...o });

beforeEach(async () => { await eraseAll(); });

describe('encryption and invites', () => {
  it('only the family key opens a snapshot', async () => {
    const key = newFamilyKey();
    expect(isFamilyKey(key)).toBe(true);
    const snap = { ...(await snapshot('A')) };
    const sealed = await sealSnapshot(snap, key);
    expect(new TextDecoder().decode(sealed)).not.toContain('Stim');
    expect((await openSnapshot(sealed, key)).device.name).toBe('A');
    await expect(openSnapshot(sealed, newFamilyKey())).rejects.toBeInstanceOf(SyncError);
    await expect(openSnapshot(new Uint8Array(50), key)).rejects.toThrow(/isn't a MedTap/);
  });
  it('invites carry the key and relay, from a code or a whole link', async () => {
    const key = newFamilyKey();
    const code = encodeInvite({ key, relay: 'https://relay.example' });
    expect(decodeInvite(code)).toEqual({ key, relay: 'https://relay.example' });
    expect(decodeInvite(`https://lumenbuild.github.io/MedTap/#/join/${code}`)?.key).toBe(key);
    expect(decodeInvite('nonsense')).toBeNull();
    expect(decodeInvite(encodeInvite({ key, relay: 'http://insecure' }))?.relay).toBeUndefined();
    expect(await familyId(key)).toMatch(/^[0-9a-f]{32}$/);
    expect(await familyId(key)).not.toContain(key);
  });
});

describe('recountStock', () => {
  const med = { id: 'm', strength: 10, stockCount: 0, stockBase: { count: 20, at: '2026-01-01T00:00:00Z' } };
  it('takes off doses logged since the count was set, and puts back older ones deleted since', () => {
    expect(recountStock(med, [
      dose({ createdAt: '2026-01-02T00:00:00Z' }),
      dose({ createdAt: '2026-01-02T00:00:00Z', deletedAt: '2026-01-03T00:00:00Z' }),
      dose({ createdAt: '2026-01-02T00:00:00Z', skipped: true }),
      dose({ createdAt: '2025-12-31T00:00:00Z' }),
      dose({ createdAt: '2025-12-31T00:00:00Z', deletedAt: '2026-01-03T00:00:00Z' }),
      dose({ createdAt: '2026-01-02T00:00:00Z', medicationId: 'other' }),
    ])).toBe(20);
  });
  it('is undefined without a starting point', () => {
    expect(recountStock({ ...med, stockBase: undefined }, [])).toBeUndefined();
  });
});

describe('merging two phones', () => {
  it('doses logged on both phones both come off the stock', async () => {
    // Phone A adds the medication with 20 tablets, and phone B gets it.
    const med = await createMed({ ...base, stockCount: 20 });
    const a0 = await snapshot('A');
    await wait(5);
    // Phone B: logs one 20 mg dose (2 tablets).
    await eraseAll();
    await mergeSnapshot(a0);
    await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 20, source: 'manual' });
    expect((await db.medications.get(med.id))?.stockCount).toBe(18);
    const b1 = await snapshot('B');
    // Phone A meanwhile logs one too, then gets B's update.
    await eraseAll();
    await importBackup(a0, 'replace');
    await wait(5);
    await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 20, source: 'manual' });
    await mergeSnapshot(b1);
    expect(await db.doses.count()).toBe(2);
    expect((await db.medications.get(med.id))?.stockCount).toBe(16);
  });

  it('a refill and a deleted dose carry across', async () => {
    const med = await createMed({ ...base, stockCount: 4 });
    await wait(5);
    const d = await logDose({ medicationId: med.id, takenAt: new Date().toISOString(), amount: 20, source: 'manual' });
    await wait(5);
    await restock(med.id, 30, false);
    await wait(5);
    await removeDose(d.id);
    const a = await snapshot('A');
    expect((await db.medications.get(med.id))?.stockCount).toBe(34);
    await eraseAll();
    await mergeSnapshot(a);
    expect((await db.medications.get(med.id))?.stockCount).toBe(34);
  });

  it("a joining phone's own records move to its own person instead of merging into the family's Me", async () => {
    // Mum starts the family: "Me" becomes Mum.
    await createMed({ ...base, name: 'Mum med' });
    await startSync('Mum');
    const key = (await getSyncConfig())!.key;
    const mum = await snapshot('A');
    // Dad's phone has his own medication under his "Me".
    await eraseAll();
    const dads = await createMed({ ...base, name: 'Dad med' });
    await join({ key }, 'Dad');
    await mergeSnapshot(mum);
    const people = await listPeople();
    expect(people.map((p) => p.name)).toEqual(['Mum', 'Dad']);
    const dad = people[1];
    expect((await db.medications.get(dads.id))?.personId).toBe(dad.id);
    expect((await db.medications.toArray()).find((m) => m.name === 'Mum med')?.personId).toBeUndefined();
    expect((await getSyncConfig())?.deviceName).toBe("Dad's phone");
  });

  it('refuses a snapshot from a newer version of the app', async () => {
    const snap = await snapshot('A');
    await expect(mergeSnapshot({ ...snap, schemaVersion: 99 })).rejects.toThrow(/newer version/);
  });
});

describe('sync relay', () => {
  const kv = () => {
    const m = new Map<string, { v: unknown; meta?: unknown }>();
    return {
      get: async (k: string) => m.get(k)?.v ?? null,
      put: async (k: string, v: unknown, o?: { metadata?: unknown }) => { m.set(k, { v, meta: o?.metadata }); },
      delete: async (k: string) => { m.delete(k); },
      list: async ({ prefix }: { prefix: string }) => ({ keys: [...m].filter(([k]) => k.startsWith(prefix)).map(([name, x]) => ({ name, metadata: x.meta })) }),
    };
  };
  const call = (env: object, method: string, path: string, body?: BodyInit, token?: string) =>
    relay.fetch(new Request(`https://relay.test${path}`, { method, body, headers: token ? { 'x-medtap-token': token } : {} }), env) as Promise<Response>;

  it('stores and lists encrypted snapshots, and only the family can write', async () => {
    const env = { SYNC: kv() };
    const fam = 'a'.repeat(32);
    const token = 'b'.repeat(64);
    expect((await call(env, 'PUT', `/v1/${fam}/device-one`, new Uint8Array([1, 2, 3]), token)).status).toBe(200);
    expect((await call(env, 'PUT', `/v1/${fam}/device-two`, new Uint8Array([4]), 'c'.repeat(64))).status).toBe(403);
    expect((await call(env, 'PUT', `/v1/${fam}/device-two`, new Uint8Array([4]))).status).toBe(403);
    const list = await (await call(env, 'GET', `/v1/${fam}`)).json();
    expect(list).toEqual([{ device: 'device-one', at: expect.any(Number), size: 3 }]);
    expect(new Uint8Array(await (await call(env, 'GET', `/v1/${fam}/device-one`)).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await call(env, 'GET', '/v1/not-a-family')).status).toBe(404);
  });
});
