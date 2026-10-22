// Family sync engine. Each phone keeps its own copy of everything; phones swap encrypted snapshots and merge them
// (newest edit of each record wins; deletions travel as "deleted" marks). Two ways to swap:
// - a relay you host (sync-relay/), which syncs automatically and only ever sees encrypted bytes;
// - an update file sent any way you like (Messages, email, AirDrop), opened on the other phone.
import { liveQuery } from 'dexie';
import { db } from '../db/db';
import { useLive } from '../db/live';
import { exportBackup, importBackup } from '../db/repos/backup';
import { validateBackup } from '../logic/backup';
import { recountStock } from '../logic/stock';
import { personRecordCount, renamePerson } from '../db/repos/people';
import { setSetting } from '../db/repos/settings';
import { DEFAULT_PERSON } from '../db/schema';
import { familyId, newFamilyKey, openSnapshot, sealSnapshot, writeToken, type Invite, type Snapshot } from '../logic/sync';
import { APP_NAME } from '../config';

export interface SyncPeer { name: string; exportedAt: string; seen: number }

export interface SyncConfig {
  key: string;
  relay?: string;
  deviceId: string;
  deviceName: string;
  lastSyncAt?: string;
  lastError?: string;
  /** Other phones whose updates have been merged, by device id. */
  peers: Record<string, SyncPeer>;
  /** Fingerprint of the last snapshot sent to the relay, to skip sending the same thing again. */
  lastSent?: string;
}

const KEY = 'sync';

export async function getSyncConfig(): Promise<SyncConfig | undefined> {
  return (await db.device.get(KEY))?.value as SyncConfig | undefined;
}

export const useSyncConfig = () => useLive(() => getSyncConfig().then((c) => c ?? null), []);

async function save(c: SyncConfig) {
  await db.device.put({ key: KEY, value: c });
}

async function update(fn: (c: SyncConfig) => void) {
  const c = await getSyncConfig();
  if (!c) return;
  fn(c);
  await save(c);
}

/** Give every medication a starting point for counting stock, so doses logged on two phones both come off. */
async function anchorStock() {
  const now = new Date().toISOString();
  const meds = await db.medications.toArray();
  for (const m of meds) {
    if (m.stockCount !== undefined && m.stockCount !== null && !m.stockBase) {
      await db.medications.update(m.id, { stockBase: { count: m.stockCount, at: now } });
    }
  }
}

async function recountAll() {
  const [meds, doses] = await Promise.all([db.medications.toArray(), db.doses.toArray()]);
  for (const m of meds) {
    const n = recountStock(m, doses);
    if (n !== undefined && n !== m.stockCount) await db.medications.update(m.id, { stockCount: n });
  }
}

const phoneName = (person: string) => (person.trim() ? `${person.trim()}'s phone` : 'Phone');

/** Start a family on this phone. "Me" here becomes the family's first person, so give it a real name. */
export async function startSync(yourName: string): Promise<SyncConfig> {
  if (yourName.trim()) await renamePerson(DEFAULT_PERSON, yourName);
  return begin({ key: newFamilyKey() }, phoneName(yourName));
}

/** Whether this phone has records of its own under "Me" (which, in the family, means whoever started it). */
export const hasOwnRecords = async () => (await personRecordCount(DEFAULT_PERSON)) > 0;

/** Every phone calls its own person "Me". Before joining, move this phone's "Me" records to a person of their own,
 *  so they don't merge into the family's "Me". */
async function moveOwnRecords(name: string) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.transaction('rw', [db.people, db.medications, db.doses, db.checkIns, db.bodyEntries, db.vitals, db.photos, db.labs, db.appointments, db.questions, db.daily], async () => {
    await db.people.put({ id, name: name.trim() || 'Me', createdAt: now, updatedAt: now });
    await db.people.delete(DEFAULT_PERSON);
    const sharedMeds = new Set((await db.medications.toArray()).filter((m) => m.shared).map((m) => m.id));
    await db.medications.filter((m) => !m.shared && !m.personId).modify({ personId: id, updatedAt: now });
    await db.doses.filter((d) => sharedMeds.has(d.medicationId) && !d.personId).modify({ personId: id, updatedAt: now });
    for (const t of [db.checkIns, db.bodyEntries, db.vitals, db.photos, db.labs, db.appointments, db.questions, db.daily] as const) {
      await (t as typeof db.checkIns).filter((r) => !r.personId).modify({ personId: id, updatedAt: now });
    }
  });
  await setSetting('activePersonId', id);
}

/** Join a family from an invite. `yourName` is who uses this phone. */
export async function join(invite: Invite, yourName: string): Promise<SyncConfig> {
  if (await hasOwnRecords()) await moveOwnRecords(yourName);
  else await setSetting('activePersonId', DEFAULT_PERSON);
  return begin(invite, phoneName(yourName));
}

async function begin(invite: Invite, deviceName: string): Promise<SyncConfig> {
  await anchorStock();
  const c: SyncConfig = { key: invite.key, relay: invite.relay, deviceId: crypto.randomUUID(), deviceName, peers: {} };
  await save(c);
  initSync();
  return c;
}

export async function leaveSync() {
  await db.device.delete(KEY);
}

export const setRelay = (relay?: string) => update((c) => { c.relay = relay?.trim().replace(/\/+$/, '') || undefined; c.lastSent = undefined; });
export const renameDevice = (name: string) => update((c) => { c.deviceName = name.trim() || c.deviceName; c.lastSent = undefined; });

async function makeSnapshot(c: SyncConfig): Promise<Snapshot> {
  const b = await exportBackup({ includePhotos: false });
  delete b.tables.settings; // settings are per phone
  return { ...b, kind: 'sync', device: { id: c.deviceId, name: c.deviceName } };
}

/** Merge another phone's snapshot into this one. */
export async function mergeSnapshot(snap: Snapshot) {
  const v = validateBackup(snap, db.verno);
  if (!v.ok) throw new Error(v.error.includes('newer') ? `Another phone has a newer version of ${APP_NAME}. Update this one to keep syncing.` : v.error);
  await importBackup(v.backup, 'merge');
  await recountAll();
}

// ── Update files ──────────────────────────────────────────────────────────────────────────────────

export async function exportUpdateFile(): Promise<Blob> {
  const c = await getSyncConfig();
  if (!c) throw new Error('Family sync is off.');
  return new Blob([await sealSnapshot(await makeSnapshot(c), c.key)], { type: 'application/octet-stream' });
}

/** Open an update file from another phone. Returns that phone's name. */
export async function importUpdateFile(file: Blob): Promise<string> {
  const c = await getSyncConfig();
  if (!c) throw new Error('Family sync is off.');
  const snap = await openSnapshot(new Uint8Array(await file.arrayBuffer()), c.key);
  if (snap.device?.id === c.deviceId) throw new Error('That update came from this phone.');
  await mergeSnapshot(snap);
  await update((x) => {
    x.peers[snap.device.id] = { name: snap.device.name, exportedAt: snap.exportedAt, seen: Date.now() };
    x.lastSyncAt = new Date().toISOString();
  });
  return snap.device.name;
}

// ── Relay ────────────────────────────────────────────────────────────────────────────────────────

interface RelayItem { device: string; at: number; size: number }

async function relayFetch(c: SyncConfig, path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${c.relay}/v1/${await familyId(c.key)}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(res.status === 403 ? 'The sync server refused this phone.' : `The sync server said ${res.status}.`);
  return res;
}

async function fingerprint(snap: Snapshot): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([snap.device, snap.tables])));
  return Array.from(new Uint8Array(h).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

let running: Promise<void> | null = null;

/** Fetch and merge other phones' updates from the relay, then send this phone's. */
export function syncNow(): Promise<void> {
  running ??= doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  const c = await getSyncConfig();
  if (!c?.relay) return;
  try {
    const list = (await (await relayFetch(c, '')).json()) as RelayItem[];
    for (const item of list) {
      if (item.device === c.deviceId || (c.peers[item.device]?.seen ?? 0) >= item.at) continue;
      const bytes = new Uint8Array(await (await relayFetch(c, `/${item.device}`)).arrayBuffer());
      const snap = await openSnapshot(bytes, c.key);
      await mergeSnapshot(snap);
      c.peers[item.device] = { name: snap.device.name, exportedAt: snap.exportedAt, seen: item.at };
    }
    const snap = await makeSnapshot(c);
    const fp = await fingerprint(snap);
    if (fp !== c.lastSent) {
      await relayFetch(c, `/${c.deviceId}`, { method: 'PUT', body: await sealSnapshot(snap, c.key), headers: { 'x-medtap-token': await writeToken(c.key) } });
      c.lastSent = fp;
    }
    c.lastSyncAt = new Date().toISOString();
    c.lastError = undefined;
  } catch (e) {
    c.lastError = e instanceof TypeError ? "Couldn't reach the sync server." : (e as Error).message;
  }
  // Keep fields changed elsewhere meanwhile (name, relay), but take this run's results.
  const latest = await getSyncConfig();
  if (latest && latest.key === c.key) {
    await save({ ...latest, peers: { ...latest.peers, ...c.peers }, lastSyncAt: c.lastSyncAt, lastError: c.lastError, lastSent: latest.relay === c.relay ? c.lastSent : undefined });
  }
}

const SYNCED_TABLES = ['people', 'medications', 'tags', 'doses', 'checkIns', 'bodyEntries', 'vitals', 'medEvents', 'supplies', 'labs', 'appointments', 'questions', 'daily'];

/** Sync with the relay on start, every 5 minutes while open, when the app comes back, and soon after changes. */
let started = false;
export function initSync() {
  if (started || typeof document === 'undefined') return;
  started = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => { void syncNow(); }, ms); };
  liveQuery(() => Promise.all(SYNCED_TABLES.map((t) => db.table(t).count()))).subscribe(() => soon(15_000));
  setInterval(() => { if (document.visibilityState === 'visible') void syncNow(); }, 5 * 60_000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') soon(1_000); });
  soon(3_000);
}
