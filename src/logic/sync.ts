// Family sync: phones that share a family key exchange encrypted snapshots of their records and merge them.
// Only phones with the key can read a snapshot: the relay (or whatever carries the file) sees random bytes.
import type { BackupFile } from './backup';
import { APP_NAME } from '../config';

const MAGIC = new TextEncoder().encode('MTS1');
const enc = new TextEncoder();
const dec = new TextDecoder();

export function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** A new random family key (256-bit), as text. */
export function newFamilyKey(): string {
  return toB64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isFamilyKey(k: string): boolean {
  try { return /^[A-Za-z0-9_-]{43}$/.test(k) && fromB64url(k).length === 32; } catch { return false; }
}

async function digestHex(label: string, key: string): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${label}:${key}`)));
  return Array.from(h, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Where the family's snapshots live on a relay. Derived from the key, but can't be turned back into it. */
export const familyId = async (key: string) => (await digestHex('medtap-family', key)).slice(0, 32);
/** Proves to a relay that a phone may write the family's snapshots. */
export const writeToken = (key: string) => digestHex('medtap-write', key);

async function aesKey(key: string) {
  return crypto.subtle.importKey('raw', fromB64url(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function gzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface Snapshot extends BackupFile {
  kind: 'sync';
  device: { id: string; name: string };
}

/** "MTS1" + 12-byte IV + AES-GCM(gzip(JSON)). */
export async function sealSnapshot(snap: Snapshot, key: string): Promise<Uint8Array<ArrayBuffer>> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), await gzip(enc.encode(JSON.stringify(snap)))));
  const out = new Uint8Array(MAGIC.length + iv.length + body.length);
  out.set(MAGIC, 0);
  out.set(iv, MAGIC.length);
  out.set(body, MAGIC.length + iv.length);
  return out;
}

export class SyncError extends Error {
  constructor(public kind: 'not-sync' | 'wrong-key', message: string) { super(message); }
}

export async function openSnapshot(bytes: Uint8Array<ArrayBuffer>, key: string): Promise<Snapshot> {
  if (bytes.length < 32 || MAGIC.some((b, i) => bytes[i] !== b)) throw new SyncError('not-sync', `This isn't a ${APP_NAME} family update.`);
  const iv = bytes.slice(MAGIC.length, MAGIC.length + 12);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(key), bytes.slice(MAGIC.length + 12));
  } catch {
    throw new SyncError('wrong-key', 'This update is from a different family.');
  }
  return JSON.parse(dec.decode(await gunzip(new Uint8Array(plain)))) as Snapshot;
}

/** Relays must use https (a local one is allowed for testing). */
export const isRelayUrl = (u: string) => /^(https:\/\/[^\s/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)(\/\S*)?$/.test(u);

/** What an invite carries: the key and, if the family uses one, the relay address. */
export interface Invite { key: string; relay?: string }

export function encodeInvite(i: Invite): string {
  return toB64url(enc.encode(JSON.stringify({ v: 1, k: i.key, r: i.relay || undefined })));
}

export function decodeInvite(code: string): Invite | null {
  try {
    const trimmed = code.trim().replace(/^.*#\/join\//, '').replace(/[^A-Za-z0-9_-].*$/, '');
    const o = JSON.parse(dec.decode(fromB64url(trimmed))) as { v?: number; k?: string; r?: string };
    if (o.v !== 1 || !o.k || !isFamilyKey(o.k)) return null;
    return { key: o.k, relay: typeof o.r === 'string' && isRelayUrl(o.r) ? o.r : undefined };
  } catch {
    return null;
  }
}
