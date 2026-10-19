import { useRef, useState } from 'react';
import { CircleCheck, Nfc } from 'lucide-react';
import { canWriteNFC } from '../../platform';
import { NFC_ERROR_TEXT, NfcError, readUrlFromTag } from '../../nfc/write';
import { tagIdFromUrl } from '../../nfc/url';
import { APP_NAME } from '../../config';
import { Button } from '../../components/ui/Button';

/** Check a tag opens the right link: scans on Android, explains how on iPhone. */
export function TagTest({ tagId, medName }: { tagId: string; medName: string }) {
  const [state, setState] = useState<'idle' | 'scanning' | 'ok' | 'wrong' | 'empty' | 'error'>('idle');
  const [error, setError] = useState('');
  const ctrl = useRef<AbortController>();

  if (!canWriteNFC) {
    return (
      <div className="rounded-btn bg-surface-2 p-4 space-y-2">
        <h3 className="font-semibold">Test it</h3>
        <ol className="list-decimal pl-5 space-y-1 text-sm">
          <li>Close this app or go to the home screen. Keep the phone unlocked.</li>
          <li>Hold the top of your iPhone near the tag.</li>
          <li>Tap the banner that appears. {APP_NAME} should open and show {medName}.</li>
        </ol>
      </div>
    );
  }

  const scan = async () => {
    ctrl.current = new AbortController();
    setState('scanning');
    try {
      const url = await readUrlFromTag(ctrl.current.signal);
      if (!url) setState('empty');
      else setState(tagIdFromUrl(url) === tagId ? 'ok' : 'wrong');
    } catch (e) {
      if (e instanceof NfcError && e.kind === 'cancelled') { setState('idle'); return; }
      setError(e instanceof NfcError ? NFC_ERROR_TEXT[e.kind] : String(e));
      setState('error');
    }
  };

  return (
    <div className="rounded-btn bg-surface-2 p-4 space-y-3" aria-live="polite">
      {state === 'ok' && <p className="flex gap-2 text-success font-semibold"><CircleCheck aria-hidden="true" /> This tag works. Tapping it opens {medName}.</p>}
      {state === 'wrong' && <p>This tag has a different link on it. Write it again, or try another tag.</p>}
      {state === 'empty' && <p>This tag is blank or has no link on it. Write it first.</p>}
      {state === 'error' && <p>{error}</p>}
      {state === 'scanning' ? (
        <>
          <p className="flex items-center gap-2"><Nfc className="text-primary animate-pulse" aria-hidden="true" /> Hold the tag to the back of your phone…</p>
          <Button variant="secondary" className="w-full" onClick={() => ctrl.current?.abort()}>Cancel</Button>
        </>
      ) : (
        <Button variant={state === 'ok' ? 'secondary' : 'primary'} className="w-full" onClick={scan}>{state === 'idle' ? 'Test this tag' : 'Test again'}</Button>
      )}
    </div>
  );
}
