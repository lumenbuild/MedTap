// App-lock PIN. A privacy screen, not encryption: we store a salted PBKDF2 hash, never the PIN.
const ITERATIONS = 150_000;

const toB64 = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b)));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin);

export function newSalt(): string {
  return toB64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(salt), iterations: ITERATIONS }, key, 256);
  return toB64(bits);
}

export async function verifyPin(pin: string, salt: string, hash: string): Promise<boolean> {
  const h = await hashPin(pin, salt);
  // Constant-time-ish compare; timing hardly matters for a local privacy screen, but it costs nothing.
  let diff = h.length ^ hash.length;
  for (let i = 0; i < Math.min(h.length, hash.length); i++) diff |= h.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
