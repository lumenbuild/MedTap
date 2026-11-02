// The Food tab's cards: the day as rings, the usual foods one tap away, closing the protein gap, the week, and your
// recipes (imported or your own) with where they came from.
import { format } from 'date-fns';
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

/** Log something now, at the given amount, with Undo. */
export function useQuickLog(personId: string) {
  const toast = useToast();
  return async (name: string, nutrients: Nutrients, servings = 1, foodId?: string) => {
    const at = new Date();
    const date = format(at, 'yyyy-MM-dd');
    const l = await logFood({ name, foodId, servings, nutrients, at: at.toISOString(), date, personId });
    toast(`Logged ${name}`, { onAction: async () => { await removeFoodLog(l, date); } });
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

/** The last 7 days: calories as bars against the target line (today still filling in), the average of the full days,
 *  and how many of them hit protein. */
export function WeekCard({ logs, target, proteinTarget, energy, now }: { logs: FoodLog[]; target: number | null; proteinTarget: number | null; energy: EnergyUnit; now: number }) {
  const days = dailyTotals(logs, now, 7);
  const full = days.slice(0, -1).filter((d) => d.logged);
  if (full.length < 2) return null;
  const avg = Math.round(full.reduce((a, d) => a + (d.n.kcal ?? 0), 0) / full.length);
  const hit = proteinTarget ? full.filter((d) => (d.n.protein ?? 0) >= proteinTarget * 0.9).length : null;
  const k = (v: number) => (energy === 'kJ' ? Math.round(v * 4.184) : Math.round(v));
  const top = Math.max(...days.map((d) => d.n.kcal ?? 0), (target ?? 0) * 1.15, 1);
  const H = 96;
  const unit = energy === 'kJ' ? 'kJ' : 'Cal';
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-medium text-muted">Last 7 days</h2>
      <div className="flex gap-6 tnum">
        <div><p className="text-[22px] font-semibold">{k(avg).toLocaleString('en-AU')}</p><p className="text-[12px] text-muted">{unit} a day{target ? `, target ${k(target).toLocaleString('en-AU')}` : ''}</p></div>
        {hit !== null && <div><p className="text-[22px] font-semibold">{hit} of {full.length}</p><p className="text-[12px] text-muted">days protein hit</p></div>}
      </div>
      <div role="img" aria-label={days.map((d, i) => `${format(d.start, 'EEEE')}${i === days.length - 1 ? ' (so far)' : ''}: ${d.logged ? `${k(d.n.kcal ?? 0)} ${unit}` : 'nothing logged'}`).join(', ')}>
        <div className="relative flex items-end gap-1.5" style={{ height: H + 6 }} aria-hidden="true">
          {target ? <div className="absolute left-0 right-0 border-t-2 border-dashed border-primary pointer-events-none" style={{ bottom: (target / top) * H }} /> : null}
          {days.map((d, i) => {
            const v = d.n.kcal ?? 0;
            const over = target !== null && v > target * 1.05;
            const today = i === days.length - 1;
            return (
              <div key={d.start} className="flex-1 flex flex-col items-center justify-end min-w-0 h-full">
                <div className="w-full max-w-[34px] rounded-t-[4px] flex justify-center pt-1" style={{ height: d.logged ? Math.max(3, (v / top) * H) : 0,
                  background: over ? 'var(--caution)' : today ? 'var(--border-strong)' : 'var(--text)' }}>
                  {d.logged && (v / top) * H >= 22 && <span className="text-[10px] font-semibold tnum leading-none" style={{ color: today ? 'var(--text)' : 'var(--bg)' }}>{(k(v) / 1000).toFixed(1)}k</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-1.5 mt-1 border-t border-border pt-1" aria-hidden="true">
          {days.map((d, i) => <span key={d.start} className={`flex-1 text-center text-[12px] ${i === days.length - 1 ? 'font-semibold' : 'text-muted'}`}>{format(d.start, 'EEEEE')}</span>)}
        </div>
      </div>
      <p className="text-[12px] text-muted">{target ? 'Dashed line: your target. Over it shows amber. ' : ''}Today is grey until it's done.</p>
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
