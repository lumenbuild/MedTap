import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import type { BodyEntry } from '../db/schema';
import type { Units } from '../db/repos/settings';
import { removeBody, restoreBody, saveBody, undoBody, upsertBody, type BodyFields } from '../db/repos/body';
import { cmTo, kgTo, lengthUnit, MEASUREMENTS, toCm, toKg, weightUnit, fmtWeight } from '../logic/units';
import { useToast } from '../app/toast';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';

export const todayYmd = () => format(Date.now(), 'yyyy-MM-dd');
const fmtDate = (ymd: string) => (ymd === todayYmd() ? 'today' : format(new Date(`${ymd}T12:00`), 'EEE d MMM'));

export type BodySheetState = { kind: 'weight' | 'measure' | 'edit'; entry?: BodyEntry } | null;

const numIn = 'w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3.5 tnum';

/** Log weight, add measurements, or edit a day's entry. */
export function BodySheet({ state, onClose, units, personId }: { state: BodySheetState; onClose: () => void; units: Units; personId: string }) {
  const [n, setN] = useState(0);
  useEffect(() => { if (state) setN((x) => x + 1); }, [state]);
  return state ? <BodyForm key={n} state={state} onClose={onClose} units={units} personId={personId} /> : null;
}

function BodyForm({ state, onClose, units, personId }: { state: NonNullable<BodySheetState>; onClose: () => void; units: Units; personId: string }) {
  const toast = useToast();
  const [date, setDate] = useState(state.entry?.date ?? todayYmd());
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const e = state.entry;
    const v: Record<string, string> = {};
    if (state.kind !== 'edit' || !e) return v;
    if (e.weightKg !== undefined) v.weightKg = String(kgTo(e.weightKg, units));
    for (const m of MEASUREMENTS) if (e[m.key] !== undefined) v[m.key] = String(cmTo(e[m.key]!, units));
    return v;
  });
  const parsed = (k: string) => (vals[k]?.trim() ? Number(vals[k]) : undefined);
  const showWeight = state.kind !== 'measure';
  const showMeasure = state.kind !== 'weight';
  const keys = [...(showWeight ? ['weightKg'] : []), ...(showMeasure ? MEASUREMENTS.map((m) => m.key) : [])];
  const invalid = keys.some((k) => { const n = parsed(k); return n !== undefined && !(n > 0 && n < 1000); });
  const any = keys.some((k) => parsed(k) !== undefined);
  const future = date > todayYmd();

  const toFields = (): BodyFields => {
    const f: BodyFields = {};
    const w = parsed('weightKg');
    if (showWeight && w !== undefined) f.weightKg = Math.round(toKg(w, units) * 100) / 100;
    if (showMeasure) for (const m of MEASUREMENTS) { const v = parsed(m.key); if (v !== undefined) f[m.key] = Math.round(toCm(v, units) * 10) / 10; }
    return f;
  };

  const save = async () => {
    if (invalid || future) return;
    const fields = toFields();
    if (state.kind === 'edit' && state.entry) {
      const e = state.entry;
      const cleared: BodyEntry = { id: e.id, date, createdAt: e.createdAt, updatedAt: e.updatedAt, note: e.note, personId: e.personId, ...fields };
      await saveBody(cleared);
      toast('Saved changes', { onAction: () => saveBody(e) });
    } else {
      if (!any) return;
      const r = await upsertBody(date, fields, personId);
      const what = fields.weightKg !== undefined && state.kind === 'weight' ? fmtWeight(fields.weightKg, units) : 'measurements';
      toast(`Saved ${what} for ${fmtDate(date)}`, { onAction: () => undoBody(r.id, r.before) });
    }
    onClose();
  };
  const del = async () => {
    if (!state.entry) return;
    const id = state.entry.id;
    await removeBody(id);
    toast(`Deleted entry for ${fmtDate(state.entry.date)}`, { onAction: () => restoreBody(id) });
    onClose();
  };

  const title = state.kind === 'weight' ? 'Log weight' : state.kind === 'measure' ? 'Add measurements' : `Edit ${fmtDate(state.entry!.date)}`;
  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="space-y-4">
        {showWeight && (
          <label className="block space-y-1.5">
            <span className="block text-sm font-medium">Weight</span>
            <span className="flex items-baseline gap-2">
              <input type="number" inputMode="decimal" step="0.1" min="0" autoFocus={state.kind === 'weight'} value={vals.weightKg ?? ''}
                onChange={(e) => setVals({ ...vals, weightKg: e.target.value })}
                className="flex-1 min-h-[64px] rounded-btn bg-surface-2 border border-border px-4 text-[32px] font-semibold tnum" />
              <span className="text-lg text-muted w-8">{weightUnit(units)}</span>
            </span>
          </label>
        )}
        {showMeasure && (
          <div className="grid grid-cols-2 gap-3">
            {MEASUREMENTS.map((m) => (
              <label key={m.key} className="block space-y-1">
                <span className="block text-sm font-medium">{m.label} <span className="text-muted font-normal">({lengthUnit(units)})</span></span>
                <input type="number" inputMode="decimal" step="0.1" min="0" value={vals[m.key] ?? ''}
                  onChange={(e) => setVals({ ...vals, [m.key]: e.target.value })} className={numIn} />
              </label>
            ))}
          </div>
        )}
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Date</span>
          <input type="date" value={date} max={todayYmd()} onChange={(e) => e.target.value && setDate(e.target.value)} className={numIn} disabled={state.kind === 'edit'} />
        </label>
        {invalid && <p className="text-sm text-danger" role="alert">Check the numbers. They need to be above 0.</p>}
        {future && <p className="text-sm text-danger" role="alert">That date hasn't happened yet.</p>}
        {showWeight && state.kind === 'weight' && <p className="text-sm text-muted">Weigh at the same time of day for the most useful trends.</p>}
        <Button className="w-full min-h-[56px]" onClick={save} disabled={invalid || future || (state.kind !== 'edit' && !any)}>Save</Button>
        {state.kind === 'edit' && <Button variant="danger" className="w-full" onClick={del}>Delete this entry</Button>}
      </div>
    </Sheet>
  );
}
