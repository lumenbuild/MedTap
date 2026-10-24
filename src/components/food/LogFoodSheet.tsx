// Log food: scan a barcode, photograph a nutrition panel, estimate a meal by hand portions, type it in, or pick
// something saved (packs, meals you make, batch recipes) and say how much.
import { useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Barcode, Camera, Hand, Keyboard, Minus, Plus, Search, Star } from 'lucide-react';
import type { Food, Nutrients, Portions } from '../../db/schema';
import { useLive } from '../../db/live';
import { db } from '../../db/db';
import { foodByBarcode, logFood, removeFoodLog, saveFood } from '../../db/repos/food';
import { useToast } from '../../app/toast';
import { readBarcode, validBarcode } from '../../app/barcode';
import { lookUpBarcode } from '../../app/foodLookup';
import { readText } from '../../app/ocr';
import {
  MEAL_SIZES, NUTRIENT, NUTRIENTS, PORTIONS, fmtEnergy, fmtNutrient, fmtPortions, noPortions, parsePanel, portionNutrients, scaleNutrients,
  type EnergyUnit, type ProductData,
} from '../../logic/nutrition';
import { Sheet, SheetActions } from '../ui/Sheet';
import { LiveScanner } from './LiveScanner';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Field';

type Step =
  | { s: 'home' }
  | { s: 'busy'; what: string }
  | { s: 'review'; draft: Draft; note?: string }
  | { s: 'amount'; food: Food }
  | { s: 'portions' }
  | { s: 'typed' };

/** A product being checked before it's saved. */
interface Draft { name: string; brand?: string; barcode?: string; serving: string; servingQty?: number; servingUnit?: 'g' | 'mL'; nutrients: Nutrients; per100?: Nutrients; source: Food['source'] }

const MAIN = ['kcal', 'protein', 'carbs', 'sugars', 'fat', 'satFat', 'fibre', 'sodium', 'caffeine'];

/** One line of the main numbers: "115 Cal · P 24 g · C 1.2 g · F 1.5 g". */
export function macroLine(n: Nutrients, energy: EnergyUnit): string {
  return [n.kcal !== undefined ? fmtEnergy(n.kcal, energy) : null, n.protein !== undefined ? `P ${fmtNutrient('protein', n.protein)}` : null,
    n.carbs !== undefined ? `C ${fmtNutrient('carbs', n.carbs)}` : null, n.fat !== undefined ? `F ${fmtNutrient('fat', n.fat)}` : null].filter(Boolean).join(' · ') || 'No numbers';
}

export function LogFoodSheet({ personId, energy, onClose }: { personId: string; energy: EnergyUnit; onClose: () => void }) {
  const toast = useToast();
  const [step, setStep] = useState<Step>({ s: 'home' });
  const [q, setQ] = useState('');
  const [typedCode, setTypedCode] = useState('');
  const barcodeInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const pendingBarcode = useRef<string | undefined>(undefined);
  const [live, setLive] = useState(false);
  const foods = useLive(() => db.foods.toArray(), []);

  const saved = useMemo(() => (foods ?? []).filter((f) => !f.deletedAt)
    .filter((f) => !q.trim() || `${f.name} ${f.brand ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(!!b.favourite) - Number(!!a.favourite) || (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '')), [foods, q]);

  const fromProduct = (p: ProductData, barcode?: string): Draft => ({ name: p.name, brand: p.brand, barcode, serving: p.serving, servingQty: p.servingQty, servingUnit: p.servingUnit, nutrients: p.nutrients, per100: p.per100, source: 'openfoodfacts' });

  const byBarcode = async (code: string) => {
    const known = await foodByBarcode(code);
    if (known) { setStep({ s: 'amount', food: known }); return; }
    setStep({ s: 'busy', what: 'Looking it up…' });
    const r = await lookUpBarcode(code);
    if (r.ok && r.product.found >= 3) { setStep({ s: 'review', draft: fromProduct(r.product, code), note: 'From Open Food Facts. Check it against the pack.' }); return; }
    pendingBarcode.current = code;
    setStep({ s: 'home' });
    toast(r.ok ? 'Found it, but with few numbers. Take a photo of the nutrition panel.' : r.reason === 'offline' ? "Couldn't reach the food database. Take a photo of the nutrition panel instead." : 'Not in the food database yet. Take a photo of the nutrition panel.');
  };

  const scan = async (file?: File) => {
    if (!file) return;
    setStep({ s: 'busy', what: 'Reading the barcode…' });
    const code = await readBarcode(file).catch(() => null);
    if (!code) { setStep({ s: 'home' }); toast("Couldn't read a barcode. Try again closer and straight on, or type the numbers."); return; }
    await byBarcode(code);
  };

  const label = async (file?: File) => {
    if (!file) return;
    setStep({ s: 'busy', what: 'Reading the panel on your phone…' });
    try {
      const text = await readText(file, () => undefined);
      const p = parsePanel(text);
      const per = Object.keys(p.perServing).length ? p.perServing : p.servingQty && Object.keys(p.per100).length ? scaleNutrients(p.per100, p.servingQty / 100) : p.per100;
      const unit = p.servingUnit ?? 'g';
      setStep({ s: 'review', note: Object.keys(per).length ? 'Read from your photo. Check each number against the panel.' : "Couldn't read the numbers. Type them in from the panel.",
        draft: { name: '', barcode: pendingBarcode.current, serving: p.servingQty ? `${p.servingQty} ${unit}` : Object.keys(p.perServing).length ? '1 serving' : `100 ${unit}`,
          servingQty: p.servingQty ?? (Object.keys(p.perServing).length ? undefined : 100), servingUnit: unit, nutrients: per, per100: Object.keys(p.per100).length ? p.per100 : undefined, source: 'label' } });
    } catch {
      setStep({ s: 'home' });
      toast("Couldn't read the photo. Try again in good light.");
    }
  };

  if (step.s === 'review') return <ReviewProduct draft={step.draft} note={step.note} energy={energy} onBack={() => setStep({ s: 'home' })}
    onSaved={(food) => { pendingBarcode.current = undefined; setStep({ s: 'amount', food }); }} onClose={onClose} />;
  if (step.s === 'amount') return <Amount food={step.food} personId={personId} energy={energy} onBack={() => setStep({ s: 'home' })} onClose={onClose} />;
  if (step.s === 'portions') return <PortionsStep personId={personId} energy={energy} onBack={() => setStep({ s: 'home' })} onClose={onClose} />;
  if (step.s === 'typed') return <TypedStep personId={personId} energy={energy} onBack={() => setStep({ s: 'home' })} onClose={onClose} />;

  return (
    <Sheet open onClose={onClose} title="Log food">
      <div className="space-y-4">
        <input ref={barcodeInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void scan(e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={labelInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void label(e.target.files?.[0]); e.target.value = ''; }} />
        {step.s === 'busy' ? <p className="text-[15px] py-6 text-center" aria-live="polite">{step.what}</p> : (
          <>
            {pendingBarcode.current && <p className="text-sm rounded-btn bg-surface-2 p-3">Barcode {pendingBarcode.current}: take a photo of its nutrition panel and it'll be saved with the barcode, so it's found next time.</p>}
            <div className="grid grid-cols-2 gap-2">
              <Choice Icon={Barcode} label="Scan a barcode" onClick={() => setLive(true)} />
              <Choice Icon={Camera} label="Photo of the label" onClick={() => labelInput.current?.click()} />
              <Choice Icon={Hand} label="Meal I made" hint="By hand portions" onClick={() => setStep({ s: 'portions' })} />
              <Choice Icon={Keyboard} label="Type it in" onClick={() => setStep({ s: 'typed' })} />
            </div>
            <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); const c = typedCode.replace(/\D/g, ''); if (validBarcode(c)) void byBarcode(c); else toast('Check the barcode numbers.'); }}>
              <div className="flex-1"><TextInput name="barcode-numbers" label="Or type the barcode numbers" inputMode="numeric" value={typedCode} onChange={(e) => setTypedCode(e.target.value)} /></div>
              <Button type="submit" variant="secondary" disabled={typedCode.replace(/\D/g, '').length < 8}>Find</Button>
            </form>
            <div>
              <label className="flex items-center gap-2 rounded-btn bg-surface-2 px-3 min-h-[48px]">
                <Search size={18} className="text-muted" aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Your saved foods and meals" aria-label="Search your saved foods and meals" className="flex-1 bg-transparent outline-none min-h-[44px]" />
              </label>
              {saved.length === 0 ? <p className="text-sm text-muted mt-2">{q ? 'Nothing saved by that name.' : 'Anything you log is saved here, to log again in one tap.'}</p> : (
                <ul className="mt-1 divide-y divide-border">
                  {saved.slice(0, 30).map((f) => (
                    <li key={f.id}>
                      <button type="button" className="w-full min-h-[56px] py-2 flex items-center gap-3 text-left" onClick={() => setStep({ s: 'amount', food: f })}>
                        <span className="flex-1 min-w-0">
                          <span className="block font-medium truncate">{f.favourite && <Star size={14} className="inline mr-1 -mt-0.5 text-caution" aria-label="Favourite" />}{f.name}{f.brand ? <span className="text-muted font-normal"> · {f.brand}</span> : null}</span>
                          <span className="block text-sm text-muted tnum truncate">{f.kind === 'meal' ? 'Meal · ' : f.kind === 'recipe' ? 'Recipe · ' : ''}{f.serving ? `${f.serving} · ` : ''}{macroLine(f.nutrients, energy)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
      {live && <LiveScanner onClose={() => setLive(false)} onCode={(code) => { setLive(false); void byBarcode(code); }}
        onPhoto={() => { setLive(false); barcodeInput.current?.click(); }} onType={() => { setLive(false); setTimeout(() => document.querySelector<HTMLInputElement>('input[name="barcode-numbers"]')?.focus(), 50); }} />}
    </Sheet>
  );
}

function Choice({ Icon, label, hint, onClick }: { Icon: typeof Barcode; label: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-[76px] rounded-card bg-surface-2 flex flex-col items-center justify-center gap-1 px-2 text-center">
      <Icon size={22} className="text-primary" aria-hidden="true" />
      <span className="text-[14px] font-medium leading-tight">{label}</span>
      {hint && <span className="text-[12px] text-muted leading-tight">{hint}</span>}
    </button>
  );
}

const toNum = (s: string) => (s.trim() === '' ? undefined : Number(s));

/** Check and edit a product's numbers before saving it. */
function ReviewProduct({ draft, note, energy, onBack, onSaved, onClose }: { draft: Draft; note?: string; energy: EnergyUnit; onBack: () => void; onSaved: (f: Food) => void; onClose: () => void }) {
  const [name, setName] = useState(draft.name);
  const [brand, setBrand] = useState(draft.brand ?? '');
  const [serving, setServing] = useState(draft.serving);
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(draft.nutrients).map(([k, v]) => [k, k === 'kcal' && energy === 'kJ' ? String(Math.round((v ?? 0) * 4.184)) : String(v)])));
  const keys = [...new Set([...MAIN, ...Object.keys(draft.nutrients)])].filter((k) => NUTRIENT[k]);
  const [extra, setExtra] = useState('');
  const shown = extra && !keys.includes(extra) ? [...keys, extra] : keys;
  const save = async () => {
    const nutrients: Nutrients = {};
    for (const k of shown) {
      const v = toNum(vals[k] ?? '');
      if (v !== undefined && v >= 0) nutrients[k] = k === 'kcal' && energy === 'kJ' ? Math.round(v / 4.184) : v;
    }
    const food = await saveFood({ kind: 'product', name: name.trim() || 'Unnamed product', brand: brand.trim() || undefined, barcode: draft.barcode, serving: serving.trim() || undefined,
      servingQty: draft.servingQty, servingUnit: draft.servingUnit, per100: draft.per100, nutrients, source: draft.source });
    onSaved(food);
  };
  return (
    <Sheet open onClose={onClose} title="Check the numbers">
      <div className="space-y-4">
        {note && <p className="text-sm text-muted">{note}</p>}
        <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Monster Ultra" />
        <TextInput label="Brand (optional)" value={brand} onChange={(e) => setBrand(e.target.value)} />
        <TextInput label="These numbers are for" value={serving} onChange={(e) => setServing(e.target.value)} help="e.g. 500 mL can, 1 scoop (30 g), 100 g" />
        <div className="grid grid-cols-2 gap-3">
          {shown.map((k) => (
            <TextInput key={k} label={`${NUTRIENT[k].label} (${k === 'kcal' ? (energy === 'kJ' ? 'kJ' : 'Cal') : NUTRIENT[k].unit})`} type="number" inputMode="decimal" min="0" step="any"
              value={vals[k] ?? ''} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
          ))}
        </div>
        <label className="block">
          <span className="block font-medium mb-1">Add another from the panel</span>
          <select value="" onChange={(e) => setExtra(e.target.value)} className="w-full min-h-[48px] rounded-btn border border-border-strong bg-bg px-3">
            <option value="">Choose…</option>
            {NUTRIENTS.filter((d) => !shown.includes(d.key)).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!name.trim()} onClick={save}>Save and choose how much</Button>
          <Button variant="secondary" className="w-full" onClick={onBack}>Back</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

function Stepper({ label, hint, value, onChange, step = 0.5 }: { label: string; hint?: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <div className="flex items-center gap-3 min-h-[56px]">
      <span className="flex-1 min-w-0"><span className="block font-medium">{label}</span>{hint && <span className="block text-sm text-muted">{hint}</span>}</span>
      <button type="button" aria-label={`Less: ${label}`} disabled={value <= 0} onClick={() => onChange(Math.max(0, value - step))} className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center disabled:opacity-40"><Minus size={18} aria-hidden="true" /></button>
      <span className="w-10 text-center text-[17px] font-semibold tnum" aria-live="polite">{value}</span>
      <button type="button" aria-label={`More: ${label}`} onClick={() => onChange(value + step)} className="w-11 h-11 rounded-full bg-surface-2 flex items-center justify-center"><Plus size={18} aria-hidden="true" /></button>
    </div>
  );
}

function When({ at, setAt }: { at: string; setAt: (v: string) => void }) {
  return <TextInput label="When" type="time" value={at} onChange={(e) => setAt(e.target.value)} />;
}
const atIso = (hhmm: string) => { const d = new Date(); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };

/** How much of a saved food: servings, grams, or a meal's size. */
function Amount({ food, personId, energy, onBack, onClose }: { food: Food; personId: string; energy: EnergyUnit; onBack: () => void; onClose: () => void }) {
  const toast = useToast();
  const meal = food.kind === 'meal';
  const options = meal ? MEAL_SIZES.map((x) => ({ f: x.f, label: x.label })) : [0.5, 1, 1.5, 2].map((f) => ({ f, label: food.kind === 'recipe' ? `${f} serve${f === 1 ? '' : 's'}` : `${f}` }));
  const [f, setF] = useState(1);
  const [qty, setQty] = useState('');
  const [at, setAt] = useState(format(new Date(), 'HH:mm'));
  const byWeight = !!food.per100 && toNum(qty) !== undefined && toNum(qty)! > 0;
  const nutrients = byWeight ? scaleNutrients(food.per100!, toNum(qty)! / 100) : scaleNutrients(food.nutrients, f);
  const servings = byWeight && food.servingQty ? Math.round((toNum(qty)! / food.servingQty) * 100) / 100 : f;
  const log = async () => {
    const when = atIso(at);
    const l = await logFood({ name: food.name, foodId: food.id, servings, nutrients, at: when, date: format(new Date(when), 'yyyy-MM-dd'), personId });
    toast(`Logged ${food.name}${(nutrients.caffeine ?? 0) >= 1 ? ' (and its caffeine)' : ''}`, { onAction: async () => { await removeFoodLog(l, format(new Date(when), 'yyyy-MM-dd')); } });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={food.name}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{meal && food.portions ? `Your usual: ${fmtPortions(food.portions)}` : food.serving ? `1 = ${food.serving}` : ''}</p>
        <div role="radiogroup" aria-label={meal ? 'Size' : 'How many'} className="grid grid-cols-4 gap-2">
          {options.map((o) => (
            <button key={o.f} type="button" role="radio" aria-checked={!byWeight && f === o.f} onClick={() => { setF(o.f); setQty(''); }}
              className={`min-h-[48px] rounded-btn text-[15px] font-medium ${!byWeight && f === o.f ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>{o.label}</button>
          ))}
        </div>
        {food.per100 && <TextInput label={`Or how much (${food.servingUnit ?? 'g'})`} type="number" inputMode="decimal" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />}
        <When at={at} setAt={setAt} />
        <NutrientList n={nutrients} energy={energy} />
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={log}>Log it</Button>
          <Button variant="secondary" className="w-full" onClick={onBack}>Back</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** The numbers: macros first, then any micros. */
export function NutrientList({ n, energy, compact = false }: { n: Nutrients; energy: EnergyUnit; compact?: boolean }) {
  const keys = NUTRIENTS.map((d) => d.key).filter((k) => n[k] !== undefined);
  if (!keys.length) return <p className="text-sm text-muted">No numbers.</p>;
  return (
    <dl className={`grid grid-cols-2 gap-x-4 ${compact ? 'gap-y-0.5 text-sm' : 'gap-y-1 text-[15px]'} tnum`}>
      {keys.map((k) => (
        <div key={k} className="flex justify-between gap-2 border-b border-border py-1">
          <dt className="text-muted truncate">{NUTRIENT[k].label}</dt><dd className="font-medium">{fmtNutrient(k, n[k], energy)}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A meal you made: tap hand portions, see the estimate, and save it to log again (smaller or bigger next time). */
function PortionsStep({ personId, energy, onBack, onClose }: { personId: string; energy: EnergyUnit; onBack: () => void; onClose: () => void }) {
  const toast = useToast();
  const [p, setP] = useState<Portions>(noPortions());
  const [name, setName] = useState('');
  const [at, setAt] = useState(format(new Date(), 'HH:mm'));
  const n = portionNutrients(p);
  const any = Object.values(p).some((v) => v > 0);
  const log = async () => {
    const when = atIso(at);
    const food = name.trim() ? await saveFood({ kind: 'meal', name: name.trim(), nutrients: n, portions: p, serving: 'Usual size', source: 'portions' }) : undefined;
    const l = await logFood({ name: name.trim() || 'Meal', foodId: food?.id, servings: 1, nutrients: n, at: when, date: format(new Date(when), 'yyyy-MM-dd'), personId });
    toast(food ? `Logged and saved ${food.name}` : 'Meal logged', { onAction: async () => { await removeFoodLog(l, format(new Date(when), 'yyyy-MM-dd')); } });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title="Meal I made">
      <div className="space-y-3">
        <p className="text-sm text-muted">No weighing: use your hand as the measure. A palm is its size and thickness, without fingers. It's an estimate, close enough to see the pattern over a week.</p>
        {PORTIONS.map((x) => <Stepper key={x.key} label={x.label} hint={x.hint} value={p[x.key]} onChange={(v) => setP({ ...p, [x.key]: v })} />)}
        <div className="rounded-btn bg-surface-2 p-3">
          <p className="font-semibold tnum">About {macroLine(n, energy)}</p>
          <p className="text-sm text-muted">{fmtPortions(p)}</p>
        </div>
        <TextInput label="Name it to log again in one tap (optional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Chicken stir fry" help="Next time, pick it and choose smaller, usual or bigger." />
        <When at={at} setAt={setAt} />
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!any} onClick={log}>Log it</Button>
          <Button variant="secondary" className="w-full" onClick={onBack}>Back</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** Numbers you know (from a menu, an app, a label you can't photograph). */
function TypedStep({ personId, energy, onBack, onClose }: { personId: string; energy: EnergyUnit; onBack: () => void; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [v, setV] = useState<Record<string, string>>({});
  const [keep, setKeep] = useState(true);
  const [at, setAt] = useState(format(new Date(), 'HH:mm'));
  const nutrients: Nutrients = {};
  for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fibre', 'caffeine']) {
    const x = toNum(v[k] ?? '');
    if (x !== undefined && x >= 0) nutrients[k] = k === 'kcal' && energy === 'kJ' ? Math.round(x / 4.184) : x;
  }
  const log = async () => {
    const when = atIso(at);
    const food = keep ? await saveFood({ kind: 'product', name: name.trim(), nutrients, serving: '1 serving', source: 'typed' }) : undefined;
    const l = await logFood({ name: name.trim(), foodId: food?.id, servings: 1, nutrients, at: when, date: format(new Date(when), 'yyyy-MM-dd'), personId });
    toast(`Logged ${name.trim()}`, { onAction: async () => { await removeFoodLog(l, format(new Date(when), 'yyyy-MM-dd')); } });
    onClose();
  };
  const field = (k: string) => (
    <TextInput key={k} label={`${NUTRIENT[k].label} (${k === 'kcal' ? (energy === 'kJ' ? 'kJ' : 'Cal') : NUTRIENT[k].unit})`} type="number" inputMode="decimal" min="0" step="any"
      value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
  );
  return (
    <Sheet open onClose={onClose} title="Type it in">
      <div className="space-y-4">
        <TextInput label="What" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Burrito bowl" />
        <div className="grid grid-cols-2 gap-3">{['kcal', 'protein', 'carbs', 'fat', 'fibre', 'caffeine'].map(field)}</div>
        <label className="flex items-center gap-3 min-h-[48px]">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} className="w-5 h-5 accent-[var(--primary)]" />
          <span>Save it to log again</span>
        </label>
        <When at={at} setAt={setAt} />
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!name.trim() || !Object.keys(nutrients).length} onClick={log}>Log it</Button>
          <Button variant="secondary" className="w-full" onClick={onBack}>Back</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}
