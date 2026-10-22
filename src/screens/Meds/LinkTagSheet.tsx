import { useEffect, useRef, useState } from 'react';
import { shownName } from '../../logic/privacy';
import { Check, Copy, Nfc, QrCode } from 'lucide-react';
import type { Medication } from '../../db/schema';
import { linkTag } from '../../db/repos/tags';
import { newTagId } from '../../logic/tagId';
import { isTemporaryTagBase, tagUrl } from '../../nfc/url';
import { NFC_ERROR_TEXT, NfcError, writeUrlToTag } from '../../nfc/write';
import { canWriteNFC, isIOS } from '../../platform';
import { useToast } from '../../app/toast';
import { Sheet, SheetActions } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';
import { TagTest } from './TagTest';

type Step = 'intro' | 'writing' | 'manual' | 'error' | 'test';

/** Link a new tag to a medication. With `vialId` (peptide tools) it's a vial tag: stuck on that vial, logging from it, and
 *  moved to the next vial when one is mixed. */
export function LinkTagSheet({ med, open, onClose, onQr, vialId }: { med: Medication; open: boolean; onClose: () => void; onQr: (url: string) => void; vialId?: string }) {
  const toast = useToast();
  const [id, setId] = useState(newTagId);
  const [label, setLabel] = useState('');
  const [step, setStep] = useState<Step>(canWriteNFC ? 'intro' : 'manual');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const ctrl = useRef<AbortController>();

  // Fresh tag ID each time the sheet opens.
  useEffect(() => {
    if (open) { setId(newTagId()); setLabel(vialId ? 'Vial tag' : ''); setStep(canWriteNFC ? 'intro' : 'manual'); setCopied(false); }
    else ctrl.current?.abort();
  }, [open]);

  const url = tagUrl(id);
  const save = async () => {
    await linkTag(id, med.id, label, vialId);
    toast(vialId ? `Tag linked to this ${shownName(med)} vial` : `Tag linked to ${shownName(med)}`);
    setStep('test');
  };

  const write = async () => {
    ctrl.current = new AbortController();
    setStep('writing');
    try {
      await writeUrlToTag(url, ctrl.current.signal);
      await save();
    } catch (e) {
      if (e instanceof NfcError && e.kind === 'cancelled') { setStep('intro'); return; }
      setError(e instanceof NfcError ? NFC_ERROR_TEXT[e.kind] : String(e));
      setStep('error');
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); } catch { setCopied(false); }
  };

  const labelField = (
    <TextInput label="Where is this tag? (optional)" placeholder="e.g. Bottle at home" value={label} onChange={(e) => setLabel(e.target.value)} autoComplete="off" />
  );
  const tempNote = isTemporaryTagBase() && (
    <p className="text-sm rounded-btn bg-caution-soft p-3">This is a test address. Tags written now will need rewriting once the app moves to its permanent address.</p>
  );

  return (
    <Sheet open={open} onClose={onClose} title={step === 'test' ? 'Tag linked' : `Link a tag to ${med.name}`}>
      <div className="space-y-4">
        {step === 'intro' && (
          <>
            {labelField}
            {tempNote}
            <SheetActions>
              <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={write}>
                <Nfc size={20} aria-hidden="true" /> Write to tag
              </Button>
              <Button variant="secondary" className="w-full" onClick={() => setStep('manual')}>Copy the link instead</Button>
            </SheetActions>
            <p className="text-sm text-muted">Use a blank NTAG213, 215 or 216 tag. On foil packs or metal tins, use an on-metal tag.</p>
          </>
        )}

        {step === 'writing' && (
          <div className="text-center py-4 space-y-4" aria-live="polite">
            <Nfc size={56} className="mx-auto text-primary animate-pulse" aria-hidden="true" />
            <p className="text-lg font-semibold">Hold the tag to the back of your phone</p>
            <p className="text-muted">Keep it still until this says it's done.</p>
            <SheetActions>
              <Button variant="secondary" className="w-full" onClick={() => ctrl.current?.abort()}>Cancel</Button>
            </SheetActions>
          </div>
        )}

        {step === 'error' && (
          <>
            <p role="alert" className="rounded-btn bg-caution-soft p-4">{error}</p>
            <SheetActions>
              <Button className="w-full min-h-[56px]" onClick={write}>Try again</Button>
              <Button variant="secondary" className="w-full" onClick={() => setStep('manual')}>Copy the link instead</Button>
            </SheetActions>
          </>
        )}

        {step === 'manual' && (
          <>
            {labelField}
            {tempNote}
            <div className="rounded-btn bg-surface-2 p-4 space-y-3">
              <p className="text-sm text-muted">Link for this tag</p>
              <p className="font-mono text-sm break-all select-all">{url}</p>
              <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={copy}>
                {copied ? <><Check size={20} aria-hidden="true" /> Copied</> : <><Copy size={20} aria-hidden="true" /> Copy link</>}
              </Button>
            </div>
            <div>
              <h3 className="font-semibold">Write it with NFC Tools (free)</h3>
              <ol className="list-decimal pl-5 mt-2 space-y-1.5">
                <li>Install <strong>NFC Tools</strong> from the {isIOS ? 'App Store' : 'Play Store'}.</li>
                <li>Open it and tap <strong>Write</strong>.</li>
                <li>Tap <strong>Add a record</strong>, then <strong>URL / URI</strong>.</li>
                <li>Paste the link and tap <strong>OK</strong>.</li>
                <li>Tap <strong>Write</strong> and hold the tag to the {isIOS ? 'top' : 'back'} of your phone.</li>
              </ol>
              <p className="text-sm text-muted mt-2">Come back here when it says the write worked.</p>
            </div>
            <SheetActions>
              <Button className="w-full min-h-[56px]" onClick={save}>I've written the tag</Button>
              <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={() => onQr(url)}>
                <QrCode size={20} aria-hidden="true" /> Print a QR sticker instead
              </Button>
            </SheetActions>
          </>
        )}

        {step === 'test' && (
          <>
            <TagTest tagId={id} medName={shownName(med)} />
            <SheetActions>
              <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={() => onQr(url)}>
                <QrCode size={20} aria-hidden="true" /> Also print a QR sticker
              </Button>
              <Button className="w-full min-h-[56px]" onClick={onClose}>Done</Button>
            </SheetActions>
          </>
        )}
      </div>
    </Sheet>
  );
}
