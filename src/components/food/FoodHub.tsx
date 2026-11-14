// The Food tab's cards: the day as rings, the usual foods one tap away, closing the protein gap, the week, and your
// recipes (imported or your own) with where they came from.
import { format } from 'date-fns';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, CookingPot, Link2, Plus, Repeat, Target } from 'lucide-react';
import { logFood, removeFoodLog } from '../../db/repos/food';
import type { Food, FoodLog, Nutrients } from '../../db/schema';
import { useToast } from '../../app/toast';
import { COMMON_FOODS } from '../../logic/commonFoods';
import type { ProteinGap } from '../../logic/dailySmarts';
import { fmtEnergy, fmtNutrient, type EnergyUnit } from '../../logic/nutrition';
import { dailyTotals, type Usual } from '../../logic/usualFoods';
import { Card } from '../ui/Card';
import { MiniRing } from '../ui/Visual';
import { sayLogged } from '../../app/logged';

/** Log something now, at the given amount, with Undo. */
export function useQuickLog(personId: string) {
  const toast = useToast();
  return async (name: string, nutrients: Nutrients, servings = 1, foodId?: string) => {
    const at = new Date();
    const date = format(at, 'yyyy-MM-dd');
    const l = await logFood({ name, foodId, servings, nutrients, at: at.toISOString(), date, personId });
    sayLogged(toast, l, `Logged ${name}${l.waterPosted ? ` · +${l.waterPosted} mL water` : ''}`, () => removeFoodLog(l, date));
  };
}

export function DayHero({ label, tot, target, proteinTarget, fibreTarget, energy, onPrev, onNext, canNext }: {
  label: string; tot: Nutrients; target: number | null; proteinTarget: number | null; fibreTarget: number; energy: EnergyUnit;
  onPrev: () => void; onNext: () => void; canNext: boolean;
}) {
  const kcal = Math.round(tot.kcal ?? 0), protein = Math.round(tot.protein ?? 0);
  const left = target ? target - kcal : null;
  const small = (l: string, v: string) => <div className="min-w-0"><p className="text-[18px] font-semibold tnum leading-tight">{v}</p><p className="text-[12px]">{l}</p></div>;
  return (
    <section className="hero act" aria-labelledby="day-h">
      <div className="flex items-center -mt-2 -mr-2">
        <h2 id="day-h" className="hero-label flex-1" aria-live="polite">{label}</h2>
        <button type="button" aria-label="Day before" onClick={onPrev} className="w-11 h-11 flex items-center justify-center"><ChevronLeft size={20} aria-hidden="true" /></button>
        <button type="button" aria-label="Day after" disabled={!canNext} onClick={onNext} className="w-11 h-11 flex items-center justify-center disabled:opacity-30"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      <div className="flex items-center gap-4 mt-1">
        <MiniRing value={kcal} max={target ?? Math.max(kcal, 1)} size={112} label={target ? `${fmtEnergy(kcal, energy)} of ${fmtEnergy(target, energy)}` : fmtEnergy(kcal, energy)}>
          <span className="flex flex-col items-center leading-tight">
            <span className="text-[22px] font-bold tnum">{fmtEnergy(left !== null ? Math.abs(left) : kcal, energy).split(' ')[0]}</span>
            <span className="text-[12px]">{left === null ? (energy === 'kJ' ? 'kJ' : 'Cal') : left >= 0 ? 'left' : 'over'}</span>
          </span>
        </MiniRing>
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-[15px] tnum"><strong>{fmtEnergy(kcal, energy).split(' ')[0]}</strong>{target ? ` of ${fmtEnergy(target, energy)}` : ` ${energy === 'kJ' ? 'kJ' : 'Cal'}`}</p>
          {proteinTarget ? (
            <div className="flex items-center gap-2">
              <MiniRing value={protein} max={proteinTarget} size={44} label={`Protein ${protein} of ${proteinTarget} g`}><span className="text-[11px] font-bold tnum">{Math.min(99, Math.round((protein / proteinTarget) * 100))}%</span></MiniRing>
              <p className="text-[15px] tnum leading-tight"><strong>{protein} g</strong> protein<br /><span className="text-[13px]">of {proteinTarget} g</span></p>
            </div>
          ) : <p className="text-[15px] tnum">Protein <strong>{protein} g</strong></p>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        {small('Carbs', fmtNutrient('carbs', Math.round(tot.carbs ?? 0)))}
        {small('Fat', fmtNutrient('fat', Math.round(tot.fat ?? 0)))}
        {small(`Fibre of ${fibreTarget} g`, fmtNutrient('fibre', Math.round(tot.fibre ?? 0)))}
      </div>
    </section>
  );
}

/** The foods eaten most lately: one tap logs the same amount as last time. */
export function UsualCard({ usual, energy, personId }: { usual: Usual[]; energy: EnergyUnit; personId: string }) {
  const quick = useQuickLog(personId);
  if (!usual.length) return null;
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-medium text-muted flex items-center gap-1.5"><Repeat size={15} aria-hidden="true" />The usual · one tap</h2>
      <ul className="grid grid-cols-2 gap-2">
        {usual.map(({ food, last }) => (
          <li key={food.id} className="min-w-0">
            <button type="button" onClick={() => void quick(food.name, last.nutrients, last.servings, food.id)}
              className="w-full min-h-[56px] rounded-btn bg-surface-2 pl-2.5 pr-3 py-2 flex items-center gap-2 text-left" aria-label={`Log ${food.name} again, ${fmtEnergy(last.nutrients.kcal ?? 0, energy)}`}>
              <Plus size={16} className="text-primary shrink-0" aria-hidden="true" />
              <span className="min-w-0"><span className="block text-[14px] font-medium truncate">{food.name}</span>
                <span className="block text-[12px] text-muted tnum">{fmtEnergy(last.nutrients.kcal ?? 0, energy)}{last.nutrients.protein ? ` · P ${Math.round(last.nutrients.protein)} g` : ''}</span></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted">The same amount as last time. Undo is on the notice.</p>
    </Card>
  );
}

/** Short on protein for the day: foods that close it, tap to log. */
export function ProteinGapCard({ g, foods, energy, personId }: { g: ProteinGap; foods: Food[]; energy: EnergyUnit; personId: string }) {
  const quick = useQuickLog(personId);
  const nutrientsOf = (name: string) => foods.find((f) => !f.deletedAt && f.name === name) ?? COMMON_FOODS.find((c) => c.name === name);
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-medium text-muted flex items-center gap-1.5"><Target size={15} aria-hidden="true" />{g.gap} g of protein to go</h2>
      <ul className="space-y-1.5">
        {g.picks.map((p) => {
          const src = nutrientsOf(p.name);
          const n = src ? ('nutrients' in src ? src.nutrients : src.n) : { protein: p.protein, kcal: p.kcal };
          return (
            <li key={p.name}>
              <button type="button" onClick={() => void quick(p.name, n, 1, src && 'nutrients' in src ? src.id : undefined)} className="w-full min-h-[52px] rounded-btn bg-surface-2 px-3 flex items-center gap-3 text-left">
                <Plus size={18} className="text-primary shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0"><span className="block font-medium truncate">{p.name}</span>{p.serving && <span className="block text-[12px] text-muted truncate">{p.serving}</span>}</span>
                <span className="text-[14px] tnum shrink-0"><strong>{Math.round(p.protein)} g</strong> · {fmtEnergy(p.kcal, energy)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {g.over && <p className="text-[12px] text-muted">A little over today's calories: on a cut, protein is the one to keep.</p>}
    </Card>
  );
}

/** The last 7 days, as one chart with a switch: calories or protein as bars against the target line (over it, amber;
 *  today grey until it's done), or each day's energy split into protein, carbs and fat. Tap a day to read it. */
type WeekView = 'energy' | 'protein' | 'macros';
const MACROS = [
  { key: 'protein', label: 'Protein', kcalPerG: 4, colour: 'var(--med-1)' },
  { key: 'carbs', label: 'Carbs', kcalPerG: 4, colour: 'var(--med-2)' },
  { key: 'fat', label: 'Fat', kcalPerG: 9, colour: 'var(--med-3)' },
] as const;

export function WeekCard({ logs, target, proteinTarget, energy, now }: { logs: FoodLog[]; target: number | null; proteinTarget: number | null; energy: EnergyUnit; now: number }) {
  const [view, setView] = useState<WeekView>(() => { try { return (localStorage.getItem('foodWeekView') as WeekView) || 'energy'; } catch { return 'energy'; } });
  const [picked, setPicked] = useState<number | null>(null);
  const days = dailyTotals(logs, now, 7);
  const full = days.slice(0, -1).filter((d) => d.logged);
  if (full.length < 2) return null;
  const choose = (v: WeekView) => { setView(v); setPicked(null); try { localStorage.setItem('foodWeekView', v); } catch { /* per-device preference only */ } };
  const k = (v: number) => (energy === 'kJ' ? Math.round(v * 4.184) : Math.round(v));
  const unit = energy === 'kJ' ? 'kJ' : 'Cal';
  const avgOf = (f: (n: (typeof days)[number]['n']) => number) => full.reduce((a, d) => a + f(d.n), 0) / full.length;
  const hit = proteinTarget ? full.filter((d) => (d.n.protein ?? 0) >= proteinTarget * 0.9).length : null;
  const H = 96;
  const dayName = (i: number) => `${format(days[i].start, 'EEEE')}${i === days.length - 1 ? ' (so far)' : ''}`;
  const macroKcal = (n: (typeof days)[number]['n']) => MACROS.map((m) => (n[m.key] ?? 0) * m.kcalPerG);

  // Bars against a target: calories or protein.
  const bars = view !== 'macros';
  const val = (n: (typeof days)[number]['n']) => (view === 'protein' ? n.protein ?? 0 : n.kcal ?? 0);
  const line = view === 'protein' ? proteinTarget : target;
  const top = Math.max(...days.map((d) => val(d.n)), (line ?? 0) * 1.15, 1);
  const show = (v: number) => (view === 'protein' ? `${Math.round(v)} g` : `${k(v).toLocaleString('en-AU')} ${unit}`);
  const head = view === 'macros'
    ? null
    : { value: view === 'protein' ? `${Math.round(avgOf((n) => n.protein ?? 0))} g` : k(avgOf((n) => n.kcal ?? 0)).toLocaleString('en-AU'),
      sub: view === 'protein' ? `protein a day${proteinTarget ? `, target ${proteinTarget} g` : ''}` : `${unit} a day${target ? `, target ${k(target).toLocaleString('en-AU')}` : ''}` };
  const macroAvg = MACROS.map((m) => avgOf((n) => n[m.key] ?? 0));
  const macroShare = (() => { const kc = MACROS.map((m, i) => macroAvg[i] * m.kcalPerG); const t = kc.reduce((a, b) => a + b, 0) || 1; return kc.map((x) => Math.round((x / t) * 100)); })();
  const readout = picked === null ? null : !days[picked].logged ? `${dayName(picked)}: nothing logged`
    : view === 'macros' ? `${dayName(picked)}: ${MACROS.map((m) => `${m.label.toLowerCase()} ${Math.round(days[picked].n[m.key] ?? 0)} g`).join(', ')}`
      : `${dayName(picked)}: ${show(val(days[picked].n))}`;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">Last 7 days</h2>
        <div role="group" aria-label="Show" className="flex gap-1">
          {(['energy', 'protein', 'macros'] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => choose(v)}
              className={`min-h-[32px] px-2.5 rounded-full text-[13px] font-medium ${view === v ? 'bg-text text-bg' : 'bg-surface-2'}`}>
              {v === 'energy' ? (energy === 'kJ' ? 'kJ' : 'Calories') : v === 'protein' ? 'Protein' : 'Macros'}
            </button>
          ))}
        </div>
      </div>
      {head ? (
        <div className="flex gap-6 tnum">
          <div><p className="text-[22px] font-semibold">{head.value}</p><p className="text-[12px] text-muted">{head.sub}</p></div>
          {hit !== null && <div><p className="text-[22px] font-semibold">{hit} of {full.length}</p><p className="text-[12px] text-muted">days protein hit</p></div>}
        </div>
      ) : (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tnum" aria-label="Average day">
          {MACROS.map((m, i) => (
            <li key={m.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="w-3 h-3 rounded-[3px]" style={{ background: m.colour }} />
              <span>{m.label} <strong>{Math.round(macroAvg[i])} g</strong> <span className="text-muted">· {macroShare[i]}%</span></span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[13px] min-h-[18px] tnum" aria-live="polite">{readout ?? ''}</p>
      <div role="img" aria-label={days.map((d, i) => `${dayName(i)}: ${!d.logged ? 'nothing logged' : view === 'macros' ? MACROS.map((m) => `${m.label} ${Math.round(d.n[m.key] ?? 0)} g`).join(', ') : show(val(d.n))}`).join('; ')}>
        <div className="relative flex items-end gap-1.5" style={{ height: H + 6 }} aria-hidden="true">
          {bars && line ? <div className="absolute left-0 right-0 border-t-2 border-dashed border-primary pointer-events-none" style={{ bottom: (line / top) * H }} /> : null}
          {days.map((d, i) => {
            const today = i === days.length - 1;
            const on = picked === i;
            return (
              <button key={d.start} type="button" tabIndex={-1} onClick={() => setPicked(on ? null : i)} onPointerEnter={(e) => { if (e.pointerType === 'mouse') setPicked(i); }}
                className={`flex-1 flex flex-col items-center justify-end min-w-0 h-full rounded-[6px] ${on ? 'bg-surface-2' : ''}`}>
                {bars ? (() => {
                  const v = val(d.n);
                  const over = view === 'energy' && line !== null && v > line * 1.05; // over a protein target is fine, so only calories go amber
                  return (
                    <div className="w-full max-w-[34px] rounded-t-[4px] flex justify-center pt-1" style={{ height: d.logged ? Math.max(3, (v / top) * H) : 0,
                      background: over ? 'var(--caution)' : today ? 'var(--border-strong)' : 'var(--text)' }}>
                      {d.logged && (v / top) * H >= 22 && <span className="text-[10px] font-semibold tnum leading-none" style={{ color: today ? 'var(--text)' : 'var(--bg)' }}>{view === 'protein' ? Math.round(v) : `${(k(v) / 1000).toFixed(1)}k`}</span>}
                    </div>
                  );
                })() : (() => {
                  // Each day as a full-height bar split by share of energy (2px gaps between the parts).
                  const kc = macroKcal(d.n); const t = kc.reduce((a, b) => a + b, 0);
                  if (!d.logged || t <= 0) return null;
                  return (
                    <div className="w-full max-w-[34px] flex flex-col-reverse gap-[2px]" style={{ height: H, opacity: today ? 0.55 : 1 }}>
                      {MACROS.map((m, j) => <div key={m.key} className={j === MACROS.length - 1 ? 'rounded-t-[4px]' : ''} style={{ height: `calc(${(kc[j] / t) * 100}% - 2px)`, background: m.colour }} />)}
                    </div>
                  );
                })()}
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5 mt-1 border-t border-border pt-1" aria-hidden="true">
          {days.map((d, i) => <span key={d.start} className={`flex-1 text-center text-[12px] ${i === days.length - 1 || picked === i ? 'font-semibold' : 'text-muted'}`}>{format(d.start, 'EEEEE')}</span>)}
        </div>
      </div>
      <p className="text-[12px] text-muted">{view === 'macros' ? 'Each day’s energy from protein, carbs and fat. ' : line ? `Dashed line: your target.${view === 'energy' ? ' Over it shows amber.' : ''} ` : ''}Today is {view === 'macros' ? 'faded' : 'grey'} until it's done. Tap a day to read it.</p>
    </Card>
  );
}

const host = (u?: string) => u?.split('/')[0];

/** Your recipes: imported (with their site) and your own batches. Tap to log a serve; edit from the pencil. */
export function RecipesCard({ recipes, energy, onLog, onEdit, onAdd, onNewBatch }: {
  recipes: Food[]; energy: EnergyUnit; onLog: (f: Food) => void; onEdit: (f: Food) => void; onAdd: () => void; onNewBatch: () => void;
}) {
  return (
    <Card className="space-y-2">
      <h2 className="text-sm font-medium text-muted flex items-center gap-1.5"><CookingPot size={15} aria-hidden="true" />Your recipes</h2>
      {recipes.length === 0 ? <p className="text-[15px] text-muted">Share a recipe from any site or app, paste your own ingredients, or enter a batch you cook. Each is saved per serve.</p> : (
        <ul className="divide-y divide-border">
          {recipes.map((f) => (
            <li key={f.id} className="flex items-center gap-2 min-h-[60px] py-1">
              <button type="button" className="flex-1 min-w-0 text-left" onClick={() => onLog(f)} aria-label={`Log a serve of ${f.name}`}>
                <span className="block font-medium truncate">{f.name}</span>
                <span className="block text-[13px] text-muted tnum truncate">{fmtEnergy(f.nutrients.kcal ?? 0, energy)} a serve{f.nutrients.protein ? ` · P ${Math.round(f.nutrients.protein)} g` : ''} · {f.recipe?.serves ?? 1} serves{f.sourceUrl ? ` · ${host(f.sourceUrl)}` : ''}</span>
              </button>
              <button type="button" onClick={() => onEdit(f)} className="min-h-[44px] px-2 text-[13px] font-medium underline underline-offset-4">Edit</button>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button type="button" onClick={onAdd} className="min-h-[48px] rounded-btn bg-surface-2 flex items-center justify-center gap-2 text-[14px] font-medium"><Link2 size={16} aria-hidden="true" />Add a recipe</button>
        <button type="button" onClick={onNewBatch} className="min-h-[48px] rounded-btn bg-surface-2 flex items-center justify-center gap-2 text-[14px] font-medium"><CookingPot size={16} aria-hidden="true" />Batch you cook</button>
      </div>
    </Card>
  );
}
