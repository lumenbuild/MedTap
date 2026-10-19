// Backup file encryption: PBKDF2-SHA-256 → AES-256-GCM. A wrong key fails authentication (no silent garbage).
const ITERATIONS = 310_000;

/** Every backup is encrypted with this built-in key, so the file can't simply be opened and read (by a person,
 *  an email preview or a cloud drive's indexing) yet any copy of the app can restore it without a password.
 *  It is not a secret: the app's code is public. It deters casual reading, not a determined attacker.
 *  Never change it, or older backups can't be restored. */
const BACKUP_KEY = 'MedTap backup v1 · 7c1f4e2a-93b8-4d55-a0f6-2e9b81d4c3aa';
const BACKUP_ITERATIONS = 1_000; // stretching adds nothing when the key is public; keep backups quick on phones
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (b: ArrayBuffer | Uint8Array) => {
  const bytes = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface Sealed { v: 1; kdf: 'PBKDF2-SHA256'; iterations: number; salt: string; iv: string; data: string }

async function key(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usage: KeyUsage) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [usage]);
}

export async function seal(plaintext: string, password: string, iterations = ITERATIONS): Promise<Sealed> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await key(password, salt, iterations, 'encrypt');
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(plaintext));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

/** Throws if the password is wrong or the file was changed. */
export async function unseal(sealed: Sealed, password: string): Promise<string> {
  const k = await key(password, fromB64(sealed.salt), sealed.iterations, 'decrypt');
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, k, fromB64(sealed.data));
  return dec.decode(data);
}

export const isSealed = (x: unknown): x is { sealed: Sealed } =>
  !!x && typeof x === 'object' && !!(x as { sealed?: Sealed }).sealed?.data;

/** Encrypt a backup's JSON with the built-in key. */
export const sealBackup = (json: string) => seal(json, BACKUP_KEY, BACKUP_ITERATIONS);
/** Decrypt a backup made by sealBackup. Throws if the file is damaged or wasn't made by this app. */
export const unsealBackup = (sealed: Sealed) => unseal(sealed, BACKUP_KEY);
