// Erase a tag so it can be used again (for another medicine, a water bottle, anything): the tag is wiped, and its link
// in the app goes with it. In the app it's one tap; the website reads the tag, then needs it held again to erase it.
import { useEffect, useRef, useState } from 'react';
import { Check, Eraser, Nfc } from 'lucide-react';
import type { Tag } from '../../db/schema';
import { forgetOldTag, unlinkTag } from '../../db/repos/tags';
import { NFC_ERROR_TEXT, NfcError, eraseTag } from '../../nfc/write';
import { tagIdFromUrl } from '../../nfc/url';
import { canWriteNFC, isIOS } from '../../platform';
import { go } from '../../app/router';
import { useToast } from '../../app/toast';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { HAS_MEDS } from '../../edition';

type Step = 'intro' | 'waiting' | 'again' | 'done' | 'error';

/** `tag` and `name`: opened from that tag's page. Whatever tag is actually held to the phone is the one erased (and
 *  loses its link); if it isn't this one, the result says so. */
export function EraseTagSheet({ open, onClose, tag, name }: { open: boolean; onClose: () => void; tag?: Tag; name?: string }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('intro');
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const ctrl = useRef<AbortController>();
  useEffect(() => { if (open) { setStep('intro'); setResult(''); } else ctrl.current?.abort(); }, [open]);

  const erase = async () => {
    ctrl.current = new AbortController();
    setStep('waiting');
    try {
      const { previous } = await eraseTag(ctrl.current.signal, () => setStep('again'));
      const old = await forgetOldTag(previous);
      const id = previous ? tagIdFromUrl(previous) : null;
      setResult(old ? `It was for ${old.what}. That link is gone, and the tag is blank.`
        : id ? 'It was one of this app’s tags, but not linked to anything here. It’s blank now.'
        : previous ? 'It had a link from somewhere else. It’s blank now.' : 'It was already blank.');
      if (tag && id && id !== tag.id) setResult((r) => `${r} That wasn’t the tag for ${name ?? 'this'}, which is still linked.`);
      setStep('done');
    } catch (e) {
      if (e instanceof NfcError && e.kind === 'cancelled') { setStep('intro'); return; }
      setError(e instanceof NfcError ? (e.kind === 'io' ? 'The tag moved away before erasing finished. Hold it still against the back of your phone and try again.' : NFC_ERROR_TEXT[e.kind]) : String(e));
      setStep('error');
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={step === 'done' ? 'Tag erased' : name ? `Erase the tag for ${name}` : 'Erase a tag'}>
      <div className="space-y-4">
        {step === 'intro' && (canWriteNFC ? (
          <>
            <p>Erasing wipes the tag so you can use it again, for another medicine or anything else. Its link in the app goes too; your history stays.</p>
            <p className="text-sm text-muted">To move a tag to another medicine, you can also just link it there: writing over it does the same.</p>
            <SheetActions>
              <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={erase}><Eraser size={20} aria-hidden="true" /> Erase tag</Button>
            </SheetActions>
          </>
        ) : (
          <>
            <p>This {isIOS ? 'browser' : 'phone or browser'} can’t erase tags. In the free <strong>NFC Tools</strong> app: <strong>Other</strong> → <strong>Erase tag</strong>, then hold the tag to your phone.</p>
            {tag && <p>Then remove its link here, so the app forgets it.</p>}
            <SheetActions>
              {tag && <Button className="w-full min-h-[56px]" onClick={async () => { await unlinkTag(tag.id); toast('Link removed'); onClose(); }}>Remove its link</Button>}
              <Button variant="secondary" className="w-full" onClick={onClose}>Close</Button>
            </SheetActions>
          </>
        ))}

        {(step === 'waiting' || step === 'again') && (
          <div className="text-center py-4 space-y-4" aria-live="polite">
            <Nfc size={56} className="mx-auto text-primary animate-pulse" aria-hidden="true" />
            <p className="text-lg font-semibold">{step === 'again' ? 'Now hold it there again to erase it' : 'Hold the tag to the back of your phone'}</p>
            <p className="text-muted">Keep it still until this says it's done.</p>
            <SheetActions><Button variant="secondary" className="w-full" onClick={() => ctrl.current?.abort()}>Cancel</Button></SheetActions>
          </div>
        )}

        {step === 'done' && (
          <>
            <p className="flex items-start gap-3"><Check size={22} aria-hidden="true" className="text-success shrink-0 mt-0.5" /><span>{result}</span></p>
            <SheetActions>
              <Button className="w-full min-h-[56px]" onClick={() => { onClose(); go(HAS_MEDS ? '/meds' : '/tags'); }}>{HAS_MEDS ? 'Link it to a medicine' : 'Link it to something'}</Button>
              <Button variant="secondary" className="w-full" onClick={erase}>Erase another</Button>
              <Button variant="secondary" className="w-full" onClick={onClose}>Done</Button>
            </SheetActions>
          </>
        )}

        {step === 'error' && (
          <>
            <p role="alert" className="rounded-btn bg-caution-soft p-4">{error}</p>
            <SheetActions>
              <Button className="w-full min-h-[56px]" onClick={erase}>Try again</Button>
              <Button variant="secondary" className="w-full" onClick={onClose}>Close</Button>
            </SheetActions>
          </>
        )}
      </div>
    </Sheet>
  );
}
