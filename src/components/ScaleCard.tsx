// Body's smart-scale card: every measure from the latest reading (with its change over the last month and what's
// healthy where there's an agreed range), visceral fat's path to the healthy range, the trends, and bringing in the
// rest of the scale's data: its export (all history) or a screenshot of a reading.
import { useEffect, useRef, useState } from 'react';
import { clearScaleReview, onScaleReview } from '../app/shareInbox';
import { format } from 'date-fns';
import { FileUp, Image as ImageIcon, Scale } from 'lucide-react';
import type { BodyEntry } from '../db/schema';
import type { Units } from '../db/repos/settings';
import { readText } from '../app/ocr';
import { saveScaleReadings } from '../app/scale';
import { useToast } from '../app/toast';
import { parseScaleCsv, parseScaleScreen, SCALE_LABEL, type ScaleField, type ScaleReading } from '../logic/scaleImport';
import { visceralPath } from '../logic/healthChecks';
import { fmtWeight } from '../logic/units';
import { Button } from './ui/Button';
import { Sheet, SheetActions } from './ui/Sheet';
import { Sparkline } from './ui/Visual';

const DAY = 86_400_000;
const ms = (d: string) => new Date(`${d}T12:00`).getTime();
const waterOf = (b: BodyEntry) => b.waterPct ?? (b.waterKg && b.weightKg ? Math.round((b.waterKg / b.weightKg) * 1000) / 10 : undefined);

type Key = Exclude<ScaleField, 'weightKg'>;
/** Which way is better, for colouring the month's change. */
const BETTER: Record<Key, 1 | -1 | 0> = { bodyFatPct: -1, leanKg: 1, subcutFatPct: -1, visceralFat: -1, waterPct: 1, skeletalMusclePct: 1, muscleKg: 1, boneKg: 0, proteinPct: 1, bmrKcal: 0, metabolicAge: -1 };
const ORDER: Key[] = ['bodyFatPct', 'visceralFat', 'muscleKg', 'skeletalMusclePct', 'leanKg', 'subcutFatPct', 'waterPct', 'proteinPct', 'boneKg', 'bmrKcal', 'metabolicAge'];

const val = (b: BodyEntry, k: Key) => (k === 'waterPct' ? waterOf(b) : (b[k] as number | undefined));

export function ScaleCard({ entries, units, personId, age }: { entries: BodyEntry[]; units: Units; personId: string; age?: number }) {
  const toast = useToast();
  const csv = useRef<HTMLInputElement>(null), shot = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<ScaleReading | null>(null);
  // A screenshot shared to the app: shown here to check before saving.
  useEffect(() => onScaleReview((r) => { setReview(r); clearScaleReview(); }), []);
  const now = Date.now();
  const rows = entries.filter((e) => !e.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
  const fmt = (k: Key, v: number) => (['leanKg', 'muscleKg', 'boneKg'].includes(k) ? fmtWeight(v, units) : k === 'bmrKcal' ? `${v.toLocaleString('en-AU')} Cal` : k === 'visceralFat' || k === 'metabolicAge' ? String(v) : `${v}%`);
  // The latest of each measure (within 3 weeks), and its value about a month before.
  const tiles = ORDER.map((k) => {
    const last = rows.find((b) => val(b, k) !== undefined);
    if (!last || ms(last.date) < now - 21 * DAY) return null;
    const prev = rows.find((b) => val(b, k) !== undefined && ms(b.date) <= ms(last.date) - 25 * DAY && ms(b.date) >= ms(last.date) - 45 * DAY);
    const v = val(last, k)!, p = prev ? val(prev, k)! : undefined;
    const d = p !== undefined ? Math.round((v - p) * 10) / 10 : undefined;
    const tone = d === undefined || d === 0 || BETTER[k] === 0 ? '' : Math.sign(d) === BETTER[k] ? 'text-success' : 'text-caution';
    const note = k === 'visceralFat' ? (v <= 9 ? 'healthy' : v < 15 ? 'high' : 'very high') : k === 'metabolicAge' && age ? (v > age ? `${v - age} over your age` : 'at or under your age') : undefined;
    return { k, v, d, tone, note, date: last.date };
  }).filter(Boolean) as { k: Key; v: number; d?: number; tone: string; note?: string; date: string }[];
  const vp = visceralPath(entries, now);
  const spark = (k: Key) => rows.filter((b) => val(b, k) !== undefined && ms(b.date) > now - 120 * DAY).map((b) => ({ t: ms(b.date), v: val(b, k)! })).reverse();
  const trends = (['bodyFatPct', 'visceralFat', 'muscleKg', 'waterPct'] as Key[]).map((k) => ({ k, p: spark(k) })).filter((x) => x.p.length >= 4);

  const fromCsv = async (f?: File) => {
    if (!f) return;
    setBusy('Reading the export…');
    try {
      const rs = parseScaleCsv(await f.text());
      if (!rs.length) { toast('No weigh-ins found in that file. Use the scale app’s data export (CSV).'); return; }
      const n = await saveScaleReadings(rs, personId);
      toast(n ? `Added ${rs.length} weigh-ins across ${n} days.` : 'Everything in that export was already here.');
    } finally { setBusy(null); }
  };
  const fromShot = async (f?: File) => {
    if (!f) return;
    setBusy('Reading the screenshot on your phone…');
    try {
      const r = parseScaleScreen(await readText(f, () => undefined), format(new Date(), 'yyyy-MM-dd'));
      if (!r) toast('Couldn’t find a scale reading in that. Screenshot the result screen with the measures showing.');
      else setReview(r);
    } catch { toast('Couldn’t read the screenshot.'); } finally { setBusy(null); }
  };

  return (
    <section className="box space-y-3" aria-labelledby="scale-h">
      <h2 id="scale-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><Scale size={15} aria-hidden="true" />Smart scale{tiles[0] ? ` · ${format(ms(tiles[0].date), 'd MMM')}` : ''}</h2>
      {tiles.length > 0 ? (
        <ul className="grid grid-cols-3 gap-1.5">
          {tiles.map((t) => (
            <li key={t.k} className="rounded-btn bg-surface-2 px-2 py-2 text-center">
              <p className="text-[17px] font-semibold tnum leading-tight">{fmt(t.k, t.v)}</p>
              <p className="text-[12px] text-muted leading-tight">{SCALE_LABEL[t.k]}</p>
              {(t.d !== undefined || t.note) && <p className={`text-[11px] tnum mt-0.5 ${t.note && t.k === 'visceralFat' && t.v > 9 ? 'text-caution' : t.tone || 'text-muted'}`}>{t.note ?? (t.d === 0 ? 'steady' : `${t.d! > 0 ? '+' : '−'}${Math.abs(t.d!)} in a month`)}</p>}
            </li>
          ))}
        </ul>
      ) : <p className="text-[15px] text-muted">Body fat, muscle, visceral fat, water, protein, BMR and metabolic age from your scale show here.</p>}
      {vp && vp.band !== 'healthy' && (
        <p className="text-[15px] rounded-btn bg-surface-2 p-3">Visceral fat {Math.round(vp.now)}, {vp.band}. {vp.healthyBy ? <>At this pace it reaches the healthy range (9 or under) around <strong>{format(vp.healthyBy, 'MMM yyyy')}</strong>. It’s the fat around the organs, and usually the first to go.</> : 'Not falling yet: it usually follows steady weight loss and activity.'}</p>
      )}
      {trends.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {trends.map(({ k, p }) => <div key={k}><p className="text-[12px] text-muted">{SCALE_LABEL[k]}, 4 months</p><Sparkline points={p} label={`${SCALE_LABEL[k]} over 4 months: ${fmt(k, p[0].v)} to ${fmt(k, p[p.length - 1].v)}`} tone={BETTER[k] === 0 ? 'plain' : (p[p.length - 1].v - p[0].v) * BETTER[k] >= 0 ? 'good' : 'watch'} /></div>)}
        </div>
      )}
      <input ref={csv} type="file" accept=".csv,text/csv,text/comma-separated-values,text/plain" className="hidden" onChange={(e) => { void fromCsv(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={shot} type="file" accept="image/*" className="hidden" onChange={(e) => { void fromShot(e.target.files?.[0]); e.target.value = ''; }} />
      {busy ? <p className="text-[15px] text-center" aria-live="polite">{busy}</p> : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => csv.current?.click()} className="min-h-[72px] rounded-btn bg-surface-2 p-3 text-left flex flex-col justify-center gap-1">
            <FileUp size={18} className="text-primary" aria-hidden="true" /><span className="text-[14px] font-medium leading-tight">Scale app’s export</span><span className="text-[12px] text-muted leading-tight">All history, every measure</span>
          </button>
          <button type="button" onClick={() => shot.current?.click()} className="min-h-[72px] rounded-btn bg-surface-2 p-3 text-left flex flex-col justify-center gap-1">
            <ImageIcon size={18} className="text-primary" aria-hidden="true" /><span className="text-[14px] font-medium leading-tight">Screenshot</span><span className="text-[12px] text-muted leading-tight">Of a reading’s results</span>
          </button>
        </div>
      )}
      <p className="text-[12px] text-muted">Weight, body fat, lean mass, bone, water and BMR arrive by themselves through Health Connect. The rest (visceral and subcutaneous fat, muscle, protein, metabolic age) come from the export or a screenshot. Scales estimate these from a small current through the body, so they swing with water: the trend is what counts.</p>
      {review && <ReviewReading r={review} units={units} onClose={() => setReview(null)} onSave={async () => { const n = await saveScaleReadings([review], personId); toast(n ? 'Reading saved' : 'That day already has these'); setReview(null); }} />}
    </section>
  );
}

function ReviewReading({ r, units, onClose, onSave }: { r: ScaleReading; units: Units; onClose: () => void; onSave: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Check the reading">
      <div className="space-y-3">
        <p className="text-sm text-muted">Read from your screenshot, for {format(ms(r.date), 'EEEE d MMMM')}. Only what this day doesn’t have yet is saved.</p>
        <ul className="divide-y divide-border">
          {(Object.entries(r.values) as [ScaleField, number][]).map(([k, v]) => (
            <li key={k} className="flex justify-between min-h-[44px] items-center"><span>{SCALE_LABEL[k]}</span><span className="tnum font-semibold">{['weightKg', 'leanKg', 'muscleKg', 'boneKg'].includes(k) ? fmtWeight(v, units) : k === 'bmrKcal' ? `${v} Cal` : k === 'visceralFat' || k === 'metabolicAge' ? v : `${v}%`}</span></li>
          ))}
        </ul>
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={onSave}>Save</Button>
          <Button variant="secondary" className="w-full" onClick={onClose}>Cancel</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}
