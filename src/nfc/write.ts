// Web NFC (Android Chrome only). iPhones can read URL tags natively but the web can't write them.
export type NfcErrorKind = 'unavailable' | 'permission' | 'unsupported-tag' | 'read-only' | 'timeout' | 'cancelled' | 'io';

export class NfcError extends Error {
  constructor(public kind: NfcErrorKind, message?: string) { super(message ?? kind); }
}

const TIMEOUT_MS = 30_000;

/** Plain-language explanation with a next step, for each failure. */
export const NFC_ERROR_TEXT: Record<NfcErrorKind, string> = {
  unavailable: "This phone or browser can't write tags. Copy the link and use the NFC Tools app instead.",
  permission: 'NFC permission was turned off. Allow NFC for this site in your browser settings, then try again.',
  'unsupported-tag': "Couldn't write the tag. It may be the wrong type (MIFARE Classic tags don't work). Try an NTAG213, 215 or 216 tag.",
  'read-only': "Couldn't write the tag. It's locked, so it can't be changed. Try a blank tag.",
  timeout: "No tag found in 30 seconds. Make sure NFC is on, then hold the tag flat against the back of your phone and keep it still.",
  cancelled: 'Cancelled.',
  io: 'The tag moved away before writing finished. Hold it still against the back of your phone and try again.',
};

function classify(e: unknown, timedOut: boolean): NfcError {
  if (timedOut) return new NfcError('timeout');
  const err = e as DOMException;
  const msg = (err?.message ?? '').toLowerCase();
  if (err?.name === 'AbortError') return new NfcError('cancelled');
  if (msg.includes('read-only') || msg.includes('read only') || msg.includes('not writable')) return new NfcError('read-only');
  if (err?.name === 'NotAllowedError') return new NfcError('permission');
  if (err?.name === 'NotSupportedError') return new NfcError('unsupported-tag');
  if (err?.name === 'NotReadableError') return new NfcError('unavailable');
  return new NfcError('io', err?.message);
}

/** Link `signal` to an internal controller that also times out. */
function withTimeout(signal?: AbortSignal) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); },
    abort: () => ctrl.abort(),
  };
}

/** Write a single URL record to the next tag held to the phone. */
export async function writeUrlToTag(url: string, signal?: AbortSignal): Promise<void> {
  if (typeof window === 'undefined' || !('NDEFReader' in window)) throw new NfcError('unavailable');
  const t = withTimeout(signal);
  try {
    await new NDEFReader().write({ records: [{ recordType: 'url', data: url }] }, { signal: t.signal });
  } catch (e) {
    throw classify(e, t.timedOut());
  } finally {
    t.done();
  }
}

/** Wait for the next tag and return the first URL on it (null if it has no URL). */
export async function readUrlFromTag(signal?: AbortSignal): Promise<string | null> {
  if (typeof window === 'undefined' || !('NDEFReader' in window)) throw new NfcError('unavailable');
  const t = withTimeout(signal);
  const reader = new NDEFReader();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      reader.onreading = (e) => {
        const rec = e.message.records.find((r) => r.recordType === 'url' || r.recordType === 'absolute-url');
        resolve(rec?.data ? new TextDecoder().decode(rec.data) : null);
      };
      reader.onreadingerror = () => reject(new NfcError('unsupported-tag'));
      t.signal.addEventListener('abort', () => reject(classify(new DOMException('', 'AbortError'), t.timedOut())));
      reader.scan({ signal: t.signal }).catch((e) => reject(classify(e, t.timedOut())));
    });
  } finally {
    t.abort(); // stop scanning
    t.done();
  }
}
