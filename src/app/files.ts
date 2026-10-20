// Getting files off the device: the share sheet where it supports files, otherwise a download.
// The native app has neither in its web view, so it uses the phone's own share sheet.
import { isNative } from '../platform';
import { MedTapNative } from '../nfc/native';

async function toBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

/** Returns false if the person cancelled the share sheet. */
export async function shareOrDownload(filename: string, blob: Blob, title: string): Promise<boolean> {
  if (isNative) {
    await MedTapNative.shareFile({ name: filename, base64: await toBase64(blob), mime: blob.type || 'application/octet-stream', title });
    return true;
  }
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return true;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return false;
      // Some browsers claim support then refuse; fall back to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return true;
}

export function readFileText(file: File): Promise<string> {
  return file.text();
}
