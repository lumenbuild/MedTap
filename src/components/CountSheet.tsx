// "Count what's left": type the count, or count tablets from a photo on the phone, then compare with what the logs say
// should be left. Doses the logs are missing can be logged (at their set times) before the count is saved.
import { useRef, useState, type MouseEvent } from 'react';
import { format } from 'date-fns';
import { Camera } from 'lucide-react';
import type { Dose, Medication } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import { countCheck } from '../logic/lifestyle';
import { countTablets, type Blob, type TabletCount } from '../logic/countTablets';
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
  const [photo, setPhoto] = useState<Counted | null>(null);
  const n = Number(counted);
  const valid = counted !== '' && n >= 0;
  const check = valid ? countCheck(med, doses, n, now, s) : null;
  const solid = countsFromPhoto(med);
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
        {photo && <PhotoMarks photo={photo} onChange={(blobs) => { setPhoto({ ...photo, result: { ...photo.result, blobs } }); setCounted(String(blobs.reduce((a, b) => a + b.n, 0))); }} />}
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

type Counted = { url: string; result: TabletCount & { w: number; h: number } };

/** The photo with a dot on each tablet found. Tapping a dot takes it away (or one from a ×2); tapping a tablet that
 *  was missed adds one. The number field above stays the way to change it without touching the photo. */
function PhotoMarks({ photo, onChange }: { photo: Counted; onChange: (blobs: Blob[]) => void }) {
  const { w, h, blobs, typicalArea } = photo.result;
  const r = Math.max(w * 0.022, Math.sqrt(typicalArea / Math.PI) * 0.55);
  const total = blobs.reduce((a, b) => a + b.n, 0);
  const tap = (e: MouseEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * w, y = ((e.clientY - box.top) / box.height) * h;
    const hit = blobs.findIndex((b) => Math.hypot(b.x - x, b.y - y) < Math.max(r * 1.6, w * 0.03));
    if (hit < 0) onChange([...blobs, { x: Math.round(x), y: Math.round(y), n: 1 }]);
    else onChange(blobs.flatMap((b, i) => (i !== hit ? [b] : b.n > 1 ? [{ ...b, n: b.n - 1 }] : [])));
  };
  return (
    <figure className="space-y-1">
      <div className="relative">
        <img src={photo.url} alt="Your photo, with each tablet counted" className="w-full rounded-btn" />
        <svg className="absolute inset-0 w-full h-full cursor-pointer" viewBox={`0 0 ${w} ${h}`} aria-hidden="true" onClick={tap}>
          {blobs.map((b, i) => (
            <g key={i}>
              <circle cx={b.x} cy={b.y} r={r} fill="#d61f69" fillOpacity="0.85" stroke="#fff" strokeWidth={r * 0.18} />
              {b.n > 1 && <text x={b.x} y={b.y + r * 0.38} textAnchor="middle" fontSize={r * 1.05} fontWeight="600" fill="#fff">×{b.n}</text>}
            </g>
          ))}
        </svg>
      </div>
      <figcaption className="text-sm text-muted">Found {total}. Tap a dot to take it away, or tap a tablet that was missed to add it. ×2 means two touching.</figcaption>
    </figure>
  );
}

/** Take a photo of the tablets spread out on a plain surface; they're counted on the phone. */
function PhotoCount({ onCount }: { onCount: (url: string, r: Counted['result']) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const read = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 720 / Math.max(bmp.width, bmp.height));
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
      <p className="text-xs text-muted mt-1">In one layer (touching is fine, not stacked) on a plain surface in a different colour (dark for white tablets), in even light. The photo isn't kept.</p>
    </div>
  );
}

/** Tablets and capsules can be counted from a photo; anything else is typed in. */
export const countsFromPhoto = (med: Medication) => /tablet|capsule/i.test(med.form);

/** "Count what's left" (with its own data): on the medication page and the Today refill card. */
export function CountButton({ med, onCounted, label = "Count what's left" }: { med: Medication; onCounted?: (n: number) => void; label?: string }) {
  const doses = useDoses();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  if (!doses || !ss || med.peptide) return null;
  return (
    <>
      <Button variant="secondary" className="flex items-center justify-center gap-2" onClick={() => setOpen(true)}>
        {countsFromPhoto(med) && <Camera size={18} aria-hidden="true" />}{label}
      </Button>
      {open && <CountSheet med={med} doses={doses} s={ss[1]} now={now} onClose={() => setOpen(false)} onCounted={onCounted} />}
    </>
  );
}

/** Meds → Count: pick which medication, then count it (tablets and capsules first, as they can use a photo). */
export function CountPicker({ meds, onClose }: { meds: Medication[]; onClose: () => void }) {
  const doses = useDoses();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const [med, setMed] = useState<Medication | null>(meds.length === 1 ? meds[0] : null);
  if (!doses || !ss) return null;
  if (med) return <CountSheet med={med} doses={doses} s={ss[1]} now={now} onClose={onClose} />;
  const list = [...meds].sort((a, b) => Number(countsFromPhoto(b)) - Number(countsFromPhoto(a)));
  return (
    <Sheet open onClose={onClose} title="Count what's left">
      <p className="text-[15px] text-muted mb-3">Tablets and capsules can be counted from a photo.</p>
      {list.length === 0 ? <p className="text-[15px]">Add a medication first.</p> : (
        <ul className="divide-y divide-border">
          {list.map((m) => (
            <li key={m.id}>
              <button type="button" className="w-full min-h-[52px] flex items-center gap-3 text-left" onClick={() => setMed(m)}>
                <span className="flex-1 min-w-0 truncate font-medium">{shownName(m)}</span>
                {countsFromPhoto(m) && <Camera size={18} className="text-muted shrink-0" aria-label="Photo count" />}
                {m.stockCount !== undefined && <span className="text-sm text-muted tnum shrink-0">{Math.round(m.stockCount * 100) / 100} left</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
