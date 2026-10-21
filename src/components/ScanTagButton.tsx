import { useRef, useState } from 'react';
import { Nfc } from 'lucide-react';
import { nfcErrorText, NfcError, readUrlFromTag } from '../nfc/write';
import { tagIdFromUrl } from '../nfc/url';
import { go } from '../app/router';
import { useToast } from '../app/toast';
import { APP_NAME } from '../config';

/** iPhone app: iPhones only read tags for an app while it's asking, so Today has a Scan tag button. */
export function ScanTagButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const ctrl = useRef<AbortController>();
  const scan = async () => {
    if (busy) { ctrl.current?.abort(); return; }
    ctrl.current = new AbortController();
    setBusy(true);
    try {
      const url = await readUrlFromTag(ctrl.current.signal);
      const id = url ? tagIdFromUrl(url) : null;
      if (id) go(`/tag/${encodeURIComponent(id)}`);
      else toast(url ? `That tag isn't a ${APP_NAME} tag.` : 'That tag is blank. Link it to a medication first.');
    } catch (e) {
      if (!(e instanceof NfcError && e.kind === 'cancelled')) toast(nfcErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={scan} aria-label="Scan tag" className="h-12 -ml-3 pl-3 pr-2 flex items-center gap-1.5 text-primary font-semibold">
      <Nfc aria-hidden="true" className={busy ? 'animate-pulse' : ''} /> <span className="text-sm">Scan</span>
    </button>
  );
}
