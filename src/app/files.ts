// Getting files off the device: the share sheet where it supports files, otherwise a download.

/** Returns false if the person cancelled the share sheet. */
export async function shareOrDownload(filename: string, blob: Blob, title: string): Promise<boolean> {
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
