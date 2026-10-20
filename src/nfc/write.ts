// Writing and reading tags. In the native app this uses our plugin (Android and iPhone);
// on the website it uses Web NFC, which only Chrome on Android has.
import { isNative, MedTapNative, nativePlatform } from './native';

export type NfcErrorKind = 'unavailable' | 'disabled' | 'permission' | 'unsupported-tag' | 'read-only' | 'too-small' | 'timeout' | 'cancelled' | 'io';

export class NfcError extends Error {
  /** `detail` is the browser's or phone's own error, shown small so a problem can be reported. */
  constructor(public kind: NfcErrorKind, public detail?: string) { super(detail ?? kind); }
}

const TIMEOUT_MS = 30_000;

/** Plain-language explanation with a next step, for each failure. */
export const NFC_ERROR_TEXT: Record<NfcErrorKind, string> = {
  unavailable: isNative
    ? "This phone doesn't have NFC, so it can't write tags. Copy the link and write it from another phone, or print a QR sticker."
    : "This phone or browser can't write tags. Copy the link and use the NFC Tools app instead.",
  disabled: 'NFC is turned off. Turn it on in your phone’s settings (Settings → Connected devices → NFC), then try again.',
  permission: 'NFC permission was turned off. Allow NFC for this site in your browser settings (tap the icon next to the address, then Permissions), then try again.',
  'unsupported-tag': "Couldn't write the tag. It may be the wrong type (MIFARE Classic tags don't work). Try an NTAG213, 215 or 216 tag.",
  'read-only': "Couldn't write the tag. It's locked, so it can't be changed. Try a blank tag.",
  'too-small': "This tag doesn't have enough space for the link. Use an NTAG213, 215 or 216 tag.",
  timeout: 'No tag found in 30 seconds. Make sure NFC is on, then hold the tag flat against the back of your phone and keep it still.',
  cancelled: 'Cancelled.',
  io: 'The tag moved away before writing finished. Hold it still against the back of your phone and try again.',
};

export const nfcErrorText = (e: unknown) => (e instanceof NfcError ? NFC_ERROR_TEXT[e.kind] : String(e));

/** Map a Web NFC (Chrome) error. Chrome's messages: "NFC setting is disabled." (NotReadableError),
 *  "NFC is not supported." (NotSupportedError), "Failed to write due to an IO error…" (NetworkError). */
export function classifyWebNfcError(e: unknown, timedOut: boolean): NfcError {
  if (timedOut) return new NfcError('timeout');
  const err = e as DOMException;
  const name = err?.name ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  const detail = name ? `${name}: ${err?.message ?? ''}` : String(e);
  if (name === 'AbortError') return new NfcError('cancelled');
  if (msg.includes('read-only') || msg.includes('read only') || msg.includes('not writable')) return new NfcError('read-only', detail);
  if (msg.includes('size') || msg.includes('too large') || msg.includes('capacity')) return new NfcError('too-small', detail);
  if (name === 'NotAllowedError') return new NfcError('permission', detail);
  if (name === 'NotReadableError' || msg.includes('disabled')) return new NfcError('disabled', detail);
  if (name === 'NotSupportedError') {
    return msg.includes('tag') || msg.includes('ndef') ? new NfcError('unsupported-tag', detail) : new NfcError('unavailable', detail);
  }
  return new NfcError('io', detail);
}

function nativeError(e: unknown): NfcError {
  const code = (e as { code?: string })?.code as NfcErrorKind | undefined;
  const message = (e as Error)?.message;
  return new NfcError(code && code in NFC_ERROR_TEXT ? code : 'io', message);
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

const hasWebNfc = () => typeof window !== 'undefined' && 'NDEFReader' in window;

async function nativeCall<T>(run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const onAbort = () => { void MedTapNative.nfcCancel(); };
  signal?.addEventListener('abort', onAbort);
  try {
    const st = await MedTapNative.nfcStatus();
    if (!st.supported) throw new NfcError('unavailable');
    if (!st.enabled) throw new NfcError('disabled');
    return await run();
  } catch (e) {
    throw e instanceof NfcError ? e : nativeError(e);
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Write a single URL record to the next tag held to the phone.
 *  The Android app also adds a record so tapping the tag opens the app; without it, Android hands the link to Chrome. */
export async function writeUrlToTag(url: string, signal?: AbortSignal): Promise<void> {
  if (isNative) return nativeCall(() => MedTapNative.nfcWrite({ url, timeoutMs: TIMEOUT_MS, openInApp: nativePlatform === 'android' }), signal);
  if (!hasWebNfc()) throw new NfcError('unavailable');
  const t = withTimeout(signal);
  try {
    await new NDEFReader().write({ records: [{ recordType: 'url', data: url }] }, { signal: t.signal });
  } catch (e) {
    throw e instanceof NfcError ? e : classifyWebNfcError(e, t.timedOut());
  } finally {
    t.done();
  }
}

/** Wait for the next tag and return the first URL on it (null if it has no URL), and, in the Android app,
 *  whether tapping it opens the app (false for tags written before that, or by the website). */
export async function readTag(signal?: AbortSignal): Promise<{ url: string | null; opensApp?: boolean }> {
  if (isNative) return nativeCall(() => MedTapNative.nfcRead({ timeoutMs: TIMEOUT_MS }), signal);
  return { url: await readUrlFromTag(signal) };
}

/** Wait for the next tag and return the first URL on it (null if it has no URL). */
export async function readUrlFromTag(signal?: AbortSignal): Promise<string | null> {
  if (isNative) return (await readTag(signal)).url;
  if (!hasWebNfc()) throw new NfcError('unavailable');
  const t = withTimeout(signal);
  const reader = new NDEFReader();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      reader.onreading = (e) => {
        const rec = e.message.records.find((r) => r.recordType === 'url' || r.recordType === 'absolute-url');
        resolve(rec?.data ? new TextDecoder().decode(rec.data) : null);
      };
      reader.onreadingerror = () => reject(new NfcError('unsupported-tag'));
      t.signal.addEventListener('abort', () => reject(classifyWebNfcError(new DOMException('', 'AbortError'), t.timedOut())));
      reader.scan({ signal: t.signal }).catch((e) => reject(classifyWebNfcError(e, t.timedOut())));
    });
  } finally {
    t.abort(); // stop scanning
    t.done();
  }
}
