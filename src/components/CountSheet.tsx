// "Count what's left": type the count, or count tablets from a photo on the phone, then compare with what the logs say
// should be left. Doses the logs are missing can be logged (at their set times) before the count is saved.
import { useRef, useState } from 'react';
import { format } from 'date-fns';
import { Camera } from 'lucide-react';
import type { Dose, Medication } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import { countCheck } from '../logic/lifestyle';
import { countTablets, type TabletCount } from '../logic/countTablets';
import { setStockCount } from '../db/repos/meds';
import { logDose, removeDose } from '../db/repos/doses';
import { shownName } from '../logic/privacy';
import { useToast } from '../app/toast';
import { useDoses, useScheduleSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { Sheet, SheetActions } from './ui/Sheet';
import { Button } from './ui/Button';
import { TextInput } from './ui/Field';

export function CountSheet({ med, doses, s, now, onClose, onCounted }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; onClose: () => void; onCounted?: (n: number) => void;
}) {
  const toast = useToast();
  const [counted, setCounted] = useState('');
  const [photo, setPhoto] = useState<{ url: string; result: TabletCount & { w: number; h: number } } | null>(null);
  const n = Number(counted);
  const valid = counted !== '' && n >= 0;
  const check = valid ? countCheck(med, doses, n, now, s) : null;
  const solid = /tablet|capsule/i.test(med.form);
  const save = async (logMissing: boolean) => {
    const ids: string[] = [];
    if (logMissing && check) for (const u of check.unlogged.slice(0, Math.round(check.doses))) ids.push((await logDose({ medicationId: med.id, takenAt: new Date(u.t).toISOString(), amount: u.amount, source: 'backdated', note: 'Logged after a recount' })).id);
    const before = await setStockCount(med.id, n);
    onCounted?.(n);
    toast(`Stock set to ${n}${ids.length ? `; ${ids.length} dose${ids.length === 1 ? '' : 's'} logged` : ''}`, {
      onAction: async () => { for (const id of ids) await removeDose(id); if (before !== undefined) await setStockCount(med.id, before); onCounted?.(before ?? n); },
    });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Count ${shownName(med)}`}>
      <div className="space-y-4">
        <TextInput label={`How many ${med.form}s are left`} type="number" inputMode="numeric" min="0" step="any" value={counted} onChange={(e) => setCounted(e.target.value)} />
        {solid && <PhotoCount onCount={(url, result) => { setPhoto({ url, result }); setCounted(String(result.count)); }} />}
        {photo && (
          <figure className="space-y-1">
            <div className="relative">
              <img src={photo.url} alt="Your photo, with each tablet counted" className="w-full rounded-btn" />
              <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${photo.result.w} ${photo.result.h}`} aria-hidden="true">
                {photo.result.blobs.map((b, i) => <g key={i}><circle cx={b.x} cy={b.y} r={Math.max(6, Math.sqrt(photo.result.typicalArea / Math.PI) * 0.6)} fill="rgba(0,0,0,.55)" /><text x={b.x} y={b.y + 4} textAnchor="middle" fontSize="12" fill="#fff">{b.n > 1 ? `×${b.n}` : ''}</text></g>)}
              </svg>
            </div>
            <figcaption className="text-sm text-muted">Counted {photo.result.count}. Each dot is one found; ×2 means two touching. Correct the number above if it's off.</figcaption>
          </figure>
        )}
        {check && (
          <div className="border-t border-border pt-3 space-y-1">
            <p className="text-[17px] tnum">Your logs say {check.expected} should be left.</p>
            {check.diff === 0 ? <p className="text-[15px]">That matches.</p>
              : check.diff > 0 ? (
                <>
                  <p className="text-[15px]">{check.diff} fewer: about {check.doses} dose{check.doses === 1 ? '' : 's'} taken but not logged, or lost.</p>
                  {check.unlogged.length > 0 && <p className="text-[15px] tnum">Nothing logged at: {check.unlogged.slice(-6).map((u) => format(u.t, 'EEE d MMM h:mm a')).join(', ')}{check.unlogged.length > 6 ? '…' : ''}</p>}
                </>
              ) : <p className="text-[15px]">{-check.diff} more than the logs say: maybe a logged dose wasn't taken, or a refill wasn't recorded.</p>}
          </div>
        )}
        <SheetActions>
          {check && check.diff > 0 && check.unlogged.length > 0 && Math.round(check.doses) >= 1 && (
            <Button className="w-full min-h-[56px]" onClick={() => save(true)}>Log {Math.min(Math.round(check.doses), check.unlogged.length)} missed and set to {n}</Button>
          )}
          <Button variant={check && check.diff > 0 && check.unlogged.length > 0 ? 'secondary' : 'primary'} className="w-full min-h-[56px]" disabled={!valid} onClick={() => save(false)}>Set stock to {valid ? n : '…'}</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** Take a photo of the tablets spread out on a plain surface; they're counted on the phone. */
function PhotoCount({ onCount }: { onCount: (url: string, r: TabletCount & { w: number; h: number }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const read = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 900 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const r = countTablets(g.getImageData(0, 0, c.width, c.height));
      onCount(c.toDataURL('image/jpeg', 0.7), { ...r, w: c.width, h: c.height });
    } finally { setBusy(false); }
  };
  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ''; }} />
      <Button variant="secondary" disabled={busy} className="w-full flex items-center justify-center gap-2" onClick={() => input.current?.click()}><Camera size={18} aria-hidden="true" /> {busy ? 'Counting…' : 'Count from a photo'}</Button>
      <p className="text-xs text-muted mt-1">Spread them out on a plain surface that's darker or lighter than they are. Counted on this phone; the photo isn't kept.</p>
    </div>
  );
}

/** "Count what's left" on the medication page (with its own data). */
export function CountButton({ med, onCounted }: { med: Medication; onCounted: (n: number) => void }) {
  const doses = useDoses();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  if (!doses || !ss || med.stockCount === undefined) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Count what's left</Button>
      {open && <CountSheet med={med} doses={doses} s={ss[1]} now={now} onClose={() => setOpen(false)} onCounted={onCounted} />}
    </>
  );
}
