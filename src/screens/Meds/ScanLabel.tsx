import { useMemo, useRef, useState } from 'react';
import { Camera, ImageUp, ScanText } from 'lucide-react';
import { parseLabel, type LabelDetails } from '../../logic/label';
import { format } from 'date-fns';
import { fmtHHmm } from '../../logic/format';
import { isNative } from '../../platform';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { TextArea } from '../../components/ui/Field';

type Step = { name: 'pick' } | { name: 'reading'; progress: number; stage: string } | { name: 'review'; text: string } | { name: 'error' };


/** One line per detail found, so the person can see what will be filled in. */
export function describeLabel(d: LabelDetails): string[] {
  const out: string[] = [];
  if (d.name) out.push(`Name: ${d.name}`);
  if (d.strength) out.push(`Strength: ${d.strength} ${d.unit}`);
  if (d.form) out.push(`Form: ${d.form}`);
  if (d.count !== undefined) out.push(`Each dose: ${d.count}`);
  const s = d.schedule;
  if (s?.type === 'fixed') {
    const times = s.slots.map((x) => `${x.count ?? d.count ?? ''}${x.count ?? d.count ? ' at ' : ''}${fmtHHmm(x.time)}`).join(', ');
    const days = s.days?.length ? ` on ${s.days.map((i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]).join(', ')}` : s.everyNDays ? ` every ${s.everyNDays} days` : '';
    out.push(`Schedule: ${times}${days}`);
  } else if (s?.type === 'interval') out.push(`Schedule: every ${s.hours} hours`);
  else if (s?.type === 'prn') {
    const lim = [s.minHoursApart ? `${s.minHoursApart} h apart` : '', s.maxDoses ? `up to ${s.maxDoses} doses in 24 h` : '', s.maxCount ? `up to ${s.maxCount} in 24 h` : ''].filter(Boolean);
    out.push(`As needed${lim.length ? `: ${lim.join(', ')}` : ''}`);
  }
  if (d.quantity !== undefined) out.push(`Quantity: ${d.quantity}`);
  if (d.repeats !== undefined) out.push(`Repeats left: ${d.repeats}`);
  if (d.prescriber) out.push(`Prescriber: ${d.prescriber}`);
  if (d.expiry) out.push(`Bottle expires ${format(new Date(`${d.expiry}T12:00`), 'd MMM yyyy')}`);
  if (d.directions) out.push(`Instructions: “${d.directions}”`);
  return out;
}

/** "Scan the pharmacy label": photo → text on this phone → details to check → fills in the form. */
export function ScanLabelCard({ onApply }: { onApply: (d: LabelDetails) => void }) {
  const [step, setStep] = useState<Step | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const library = useRef<HTMLInputElement>(null);

  const read = async (file?: File) => {
    if (!file) return;
    setStep({ name: 'reading', progress: 0, stage: 'loading' });
    try {
      const { readText } = await import('../../app/ocr');
      const text = await readText(file, (progress, stage) => setStep({ name: 'reading', progress, stage }));
      setStep({ name: 'review', text: text.trim() });
    } catch (e) {
      console.error('ocr', e);
      setStep({ name: 'error' });
    }
  };

  const pick = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={library} type="file" accept="image/*" className="hidden" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} />
    </>
  );

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-medium text-muted flex items-center gap-2"><ScanText size={20} className="text-primary" aria-hidden="true" /> Scan the pharmacy label</h2>
      <p className="text-sm text-muted">Take a photo of the label and {isNative ? 'the app' : 'this page'} fills in the details for you to check. The photo is read on this phone and isn't kept or sent anywhere.</p>
      {pick}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" className="flex items-center justify-center gap-2" onClick={() => camera.current?.click()}><Camera size={18} aria-hidden="true" /> Take photo</Button>
        <Button variant="secondary" className="flex items-center justify-center gap-2" onClick={() => library.current?.click()}><ImageUp size={18} aria-hidden="true" /> Choose photo</Button>
      </div>
      <Sheet open={!!step} onClose={() => setStep(null)} title="Pharmacy label">
        {step?.name === 'reading' && <Reading progress={step.progress} stage={step.stage} />}
        {step?.name === 'error' && (
          <div className="space-y-3">
            <p role="alert" className="rounded-btn bg-caution-soft p-3">Couldn't read the photo. {navigator.onLine ? 'Try again, or type the details in.' : 'The first scan needs an internet connection to download the label reader.'}</p>
            <Button className="w-full" onClick={() => setStep(null)}>OK</Button>
          </div>
        )}
        {step?.name === 'review' && (
          <Review text={step.text} onRetake={() => { setStep(null); camera.current?.click(); }}
            onUse={(d) => { onApply(d); setStep(null); }} />
        )}
      </Sheet>
    </Card>
  );
}

function Reading({ progress, stage }: { progress: number; stage: string }) {
  const recognising = stage.startsWith('recognizing');
  const pct = Math.round((recognising ? progress : 0) * 100);
  return (
    <div className="py-4 space-y-3 text-center" aria-live="polite">
      <ScanText size={48} className="mx-auto text-primary animate-pulse" aria-hidden="true" />
      <p className="text-lg font-semibold">{recognising ? `Reading the label… ${pct}%` : 'Getting the label reader ready…'}</p>
      <div className="h-2 rounded-full bg-surface-2 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Reading the label">
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      {!recognising && !isNative && <p className="text-sm text-muted">The first time, this downloads the reader (about 6 MB) from {location.host}.</p>}
    </div>
  );
}

function Review({ text, onRetake, onUse }: { text: string; onRetake: () => void; onUse: (d: LabelDetails) => void }) {
  const [t, setT] = useState(text);
  const details = useMemo(() => parseLabel(t), [t]);
  const lines = describeLabel(details);
  return (
    <div className="space-y-4">
      {lines.length ? (
        <div className="rounded-btn bg-surface-2 p-3">
          <p className="font-semibold mb-1">Found on the label</p>
          <ul className="text-sm space-y-1">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
        </div>
      ) : (
        <p className="rounded-btn bg-caution-soft p-3">Couldn't find the medication details. Try a closer, sharper photo in good light, or fix the text below.</p>
      )}
      <TextArea label="Text read from the photo" help="Fix anything misread and the details above update." rows={7} value={t} onChange={(e) => setT(e.target.value)} />
      <p className="text-sm text-muted">Check every detail against the label before saving. Your pharmacist can help with anything unclear.</p>
      <Button className="w-full min-h-[56px]" onClick={() => onUse(details)} disabled={!lines.length}>Use these details</Button>
      <Button variant="secondary" className="w-full" onClick={onRetake}>Take another photo</Button>
    </div>
  );
}
