// Food: a day's totals (macros and every micro the labels gave), what was logged, saved foods, meals and batch
// recipes, and the energy unit and target.
import { setOwnTarget } from '../app/targets';
import { useMemo, useRef, useState } from 'react';
import { addDays, format } from 'date-fns';
import { Barcode, ChevronLeft, ChevronRight, CookingPot, Plus, Star, Trash2 } from 'lucide-react';
import type { BodyEntry, Food, FoodLog, Nutrients } from '../db/schema';
import { useLive } from '../db/live';
import { db } from '../db/db';
import { useBodyEntries, useDaily, useFamily, useSettings } from '../app/data';
import { eatingPatterns, WHY_LABEL } from '../logic/eating';
import { updateCalorieTarget } from '../app/maintenance';
import { calorieTarget, expenditure } from '../logic/energy';
import { kgTo, toKg, weightUnit } from '../logic/units';
import type { ScheduleSettings } from '../logic/schedule';
import { HAS_BODY } from '../edition';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { personOf } from '../db/repos/people';
import { scheduleSettings, setSetting, type Units } from '../db/repos/settings';
import { changeServings, foodByBarcode, removeFood, removeFoodLog, restoreFoodLog, saveFood, updateFood } from '../db/repos/food';
import { readBarcode } from '../app/barcode';
import { lookUpBarcode } from '../app/foodLookup';
import { NUTRIENT, addNutrients, fmtEnergy, fmtNutrient, scaleNutrients, totalsFor, type EnergyUnit } from '../logic/nutrition';
import { fmtDay, fmtTime } from '../logic/format';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sheet, SheetActions } from '../components/ui/Sheet';
import { Segmented, TextInput } from '../components/ui/Field';
import { Bar } from '../components/ui/Visual';
import { LogFoodSheet, NutrientList, macroLine } from '../components/food/LogFoodSheet';
import { LiveScanner } from '../components/food/LiveScanner';
import { EnergyCard } from '../components/HealthCards';
import { energyBalance } from '../logic/energy';

const frac = (f: number) => (f === 0.5 ? '½' : f === 1.5 ? '1½' : f === 0.75 ? '¾' : f === 1.25 ? '1¼' : String(f));

export function FoodScreen() {
  const settings = useSettings();
  const fam = useFamily();
  const now = useNow(60_000);
  const logs = useLive(() => db.foodLogs.toArray(), []);
  const foods = useLive(() => db.foods.toArray(), []);
  const body = useBodyEntries();
  const daily = useDaily();
  const [back, setBack] = useState(0);
  const [logging, setLogging] = useState(false);
  const [editing, setEditing] = useState<FoodLog | null>(null);
  const [recipe, setRecipe] = useState<Food | 'new' | null>(null);
  if (!settings || !fam || !logs || !foods || !body) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const energy = settings.energyUnit;
  const day = addDays(new Date(now), -back);
  const start = new Date(day); start.setHours(0, 0, 0, 0);
  const end = addDays(start, 1);
  const mine = logs.filter((l) => personOf(l) === fam.personId);
  const today = mine.filter((l) => !l.deletedAt && Date.parse(l.at) >= start.getTime() && Date.parse(l.at) < end.getTime()).sort((a, b) => a.at.localeCompare(b.at));
  const tot = totalsFor(today, start.getTime(), end.getTime());
  const saved = foods.filter((f) => !f.deletedAt).sort((a, b) => Number(!!b.favourite) - Number(!!a.favourite) || a.name.localeCompare(b.name));
  const label = back === 0 ? 'Today' : back === 1 ? 'Yesterday' : fmtDay(day.getTime(), now);
  const target = settings.energyTargetKcal;

  return (
    <div className="space-y-4">
      <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={() => setLogging(true)}><Plus size={20} aria-hidden="true" /> Log food</Button>

      <Card className="space-y-3">
        <div className="flex items-center gap-1 -my-2">
          <h2 className="flex-1 text-sm font-medium text-muted" aria-live="polite">{label}</h2>
          <button type="button" aria-label="Day before" onClick={() => setBack(back + 1)} className="w-11 h-11 flex items-center justify-center text-muted"><ChevronLeft size={20} aria-hidden="true" /></button>
          <button type="button" aria-label="Day after" disabled={back === 0} onClick={() => setBack(back - 1)} className="w-11 h-11 -mr-3 flex items-center justify-center text-muted disabled:opacity-30"><ChevronRight size={20} aria-hidden="true" /></button>
        </div>
        <p className="tnum"><span className="text-[28px] font-semibold">{fmtEnergy(tot.kcal ?? 0, energy).split(' ')[0]}</span> <span className="text-muted">{energy === 'kJ' ? 'kJ' : 'Cal'}{target ? ` of ${fmtEnergy(target, energy)}` : ''}</span></p>
        {target ? <Bar value={tot.kcal ?? 0} max={Math.max(target, tot.kcal ?? 0)} tone={(tot.kcal ?? 0) > target * 1.1 ? 'watch' : 'plain'} label={`Energy ${fmtEnergy(tot.kcal ?? 0, energy)} of ${fmtEnergy(target, energy)}`} /> : null}
        <MacroSplit n={tot} />
        {/* Fibre: low on GLP-1s, and the usual first help for constipation. */}
        <div className="space-y-1">
          <p className="text-sm tnum flex justify-between"><span>Fibre</span><span className="text-muted">{Math.round(tot.fibre ?? 0)} of {settings.fibreTargetG} g</span></p>
          <Bar value={tot.fibre ?? 0} max={settings.fibreTargetG} tone={(tot.fibre ?? 0) >= settings.fibreTargetG ? 'good' : 'plain'} label={`Fibre ${Math.round(tot.fibre ?? 0)} of ${settings.fibreTargetG} g`} />
        </div>
        {today.length === 0 ? <p className="text-muted">Nothing logged {back === 0 ? 'yet today' : 'this day'}.</p> : (
          <ol className="-mx-2">
            {today.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => setEditing(l)} className="w-full min-h-[52px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                  <span className="w-[4.5rem] tnum text-muted shrink-0">{fmtTime(Date.parse(l.at))}</span>
                  <span className="flex-1 min-w-0"><span className="block font-medium truncate">{l.name}{l.servings !== 1 ? <span className="text-muted font-normal"> × {frac(l.servings)}</span> : null}</span>
                    <span className="block text-sm text-muted tnum truncate">{macroLine(l.nutrients, energy)}</span></span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {Object.keys(tot).some((k) => NUTRIENT[k]?.group === 'micro' || !['kcal', 'protein', 'carbs', 'fat'].includes(k)) && (
          <details>
            <summary className="min-h-[44px] flex items-center font-medium cursor-pointer">Everything in it</summary>
            <NutrientList n={tot} energy={energy} />
            <p className="text-xs text-muted mt-2">From the labels and your estimates. Meals by hand portions only count energy, protein, carbs, fat and fibre.</p>
          </details>
        )}
      </Card>
      {(() => {
        // With the watch: calories burned against eaten, and where that takes your weight.
        const e = daily ? energyBalance(daily.filter((d) => personOf(d) === fam.personId), mine, now, scheduleSettings(settings)) : null;
        return e ? <EnergyCard e={e} /> : null;
      })()}

      <Card className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted">Saved</h2>
          <button type="button" className="min-h-[44px] flex items-center gap-1.5 text-sm font-medium" onClick={() => setRecipe('new')}><CookingPot size={16} aria-hidden="true" /> New batch recipe</button>
        </div>
        {saved.length === 0 ? <p className="text-muted text-[15px]">Products you scan, meals you name and batch recipes show here.</p> : (
          <ul className="divide-y divide-border">
            {saved.map((f) => (
              <li key={f.id} className="flex items-center gap-2 min-h-[56px] py-1">
                <button type="button" aria-label={f.favourite ? `Unstar ${f.name}` : `Star ${f.name}`} aria-pressed={!!f.favourite} onClick={() => updateFood(f.id, { favourite: !f.favourite })} className="w-11 h-11 -ml-2 flex items-center justify-center">
                  <Star size={18} className={f.favourite ? 'text-caution fill-current' : 'text-muted'} aria-hidden="true" />
                </button>
                <button type="button" className="flex-1 min-w-0 text-left" onClick={() => f.kind === 'recipe' ? setRecipe(f) : undefined} disabled={f.kind !== 'recipe'}>
                  <span className="block font-medium truncate">{f.name}{f.brand ? <span className="text-muted font-normal"> · {f.brand}</span> : null}</span>
                  <span className="block text-sm text-muted tnum truncate">{f.kind === 'meal' ? 'Meal · ' : f.kind === 'recipe' ? `Recipe, ${f.recipe?.serves ?? 1} serves · ` : ''}{macroLine(f.nutrients, energy)}</span>
                </button>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => removeFood(f.id)} className="w-11 h-11 -mr-2 flex items-center justify-center text-muted"><Trash2 size={18} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted">Energy</h2>
        <Segmented<EnergyUnit> label="Show energy in" value={energy} onChange={(v) => setSetting('energyUnit', v)} options={[{ value: 'kcal', label: 'Calories' }, { value: 'kJ', label: 'Kilojoules' }]} />
        <TextInput key={`fibre-${settings.fibreTargetG}`} label="Fibre a day (g)" type="number" inputMode="numeric" min="5" max="80" step="1" defaultValue={String(settings.fibreTargetG)}
          onBlur={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 5 && v <= 80 && v !== settings.fibreTargetG) void setOwnTarget('fibre', v); }} help="25 to 30 g is the usual aim. More vegetables, fruit, oats, beans and wholegrains." />
        {HAS_BODY && <Segmented label="Daily target" value={settings.energyAuto ? 'auto' : 'own'} options={[{ value: 'own', label: 'My own number' }, { value: 'auto', label: 'Worked out for me' }]}
          onChange={async (v) => { await setSetting('energyAuto', v === 'auto'); if (v === 'auto') { await setSetting('energyAutoAt', 0); await updateCalorieTarget(); } }} />}
        {HAS_BODY && settings.energyAuto
          ? <WorkedOutTarget logs={mine} body={body.filter((b) => personOf(b) === fam.personId)} rate={settings.lossRateKgWeek} target={target} energy={energy} units={settings.units} now={now} s={scheduleSettings(settings)} />
          : <TextInput key={target ?? 'none'} label={`Daily target (${energy === 'kJ' ? 'kJ' : 'Cal'}, optional)`} type="number" inputMode="numeric" min="0" step="1"
              defaultValue={target ? String(energy === 'kJ' ? Math.round(target * 4.184) : target) : ''}
              onBlur={(e) => { const v = Number(e.target.value); setSetting('energyTargetKcal', v > 0 ? Math.round(energy === 'kJ' ? v / 4.184 : v) : null); }} help="Your own number, or your dietitian's." />}
      </Card>

      {(() => {
        // Why you eat: from the logs where you said how hungry, or why.
        const e = eatingPatterns(mine, daily?.filter((x) => personOf(x) === fam.personId) ?? [], now, scheduleSettings(settings), settings.proteinTargetG);
        if (!e) return null;
        return (
          <Card className="space-y-2">
            <h2 className="text-sm font-medium text-muted">Why you eat · last 30 days</h2>
            <p className="tnum"><span className="text-[24px] font-semibold">{e.notHungryPct}%</span> <span className="text-muted">without real hunger, of {e.answered} you noted</span></p>
            <Bar value={e.notHungryPct} max={100} tone={e.notHungryPct > 40 ? 'watch' : 'plain'} label={`${e.notHungryPct}% eaten without real hunger`} />
            <ul className="text-[15px] space-y-0.5">
              {e.topWhy && <li>Most often: {WHY_LABEL[e.topWhy.why]} ({e.topWhy.n})</li>}
              {e.eveningPct !== undefined && <li>{e.eveningPct}% of it after 6 pm</li>}
              {e.shortSleep && <li>After a short night: {e.shortSleep.withPct}% of days, against {e.shortSleep.withoutPct}%</li>}
              {e.lowProtein && <li>On low-protein days: {e.lowProtein.withPct}% of days, against {e.lowProtein.withoutPct}%</li>}
            </ul>
            <p className="text-xs text-muted">From “How hungry were you?” when logging. Links, not causes.</p>
          </Card>
        );
      })()}

      {logging && <LogFoodSheet personId={fam.personId} energy={energy} onClose={() => setLogging(false)} />}
      {editing && <EditLogSheet log={editing} energy={energy} onClose={() => setEditing(null)} />}
      {recipe && <RecipeSheet recipe={recipe === 'new' ? undefined : recipe} foods={saved.filter((f) => f.kind !== 'recipe')} energy={energy} onClose={() => setRecipe(null)} />}
    </div>
  );
}

/** The calorie target worked out from what the person burns (their food logs against their weight trend), for the
 *  rate of loss they choose; updated each week. */
function WorkedOutTarget({ logs, body, rate, target, energy, units, now, s }: {
  logs: FoodLog[]; body: BodyEntry[]; rate: number; target: number | null; energy: EnergyUnit; units: Units; now: number; s: ScheduleSettings;
}) {
  const e = expenditure(logs, body, now, s);
  const en = (kcal: number) => fmtEnergy(kcal, energy);
  const u = weightUnit(units);
  const days = new Set(logs.filter((l) => !l.deletedAt && Date.parse(l.at) > now - 28 * 86_400_000).map((l) => l.at.slice(0, 10))).size;
  const weighIns = body.filter((b) => !b.deletedAt && b.weightKg !== undefined && Date.parse(`${b.date}T08:00`) > now - 28 * 86_400_000).length;
  return (
    <div className="space-y-3">
      {e ? (
        <div className="rounded-btn bg-surface-2 p-3 space-y-1">
          <p className="text-[15px]">You burn about <strong className="tnum">{en(e.kcal)}</strong> a day <span className="text-muted tnum">(likely {en(e.low)}–{en(e.high)})</span></p>
          <p className="text-[15px] tnum">Your target: <strong>{target ? en(target) : en(calorieTarget(e, rate).kcal)}</strong>{calorieTarget(e, rate).capped ? ' (no more than a quarter under what you burn)' : ''}</p>
          <p className="text-xs text-muted tnum">From {e.days} days of food and {e.weighIns} weigh-ins in the last 4 weeks: you ate about {en(e.intake)} a day while {e.kgPerWeek <= 0 ? 'losing' : 'gaining'} {kgTo(Math.abs(e.kgPerWeek), units)} {u} a week. Updated each week.</p>
        </div>
      ) : (
        <p className="text-[15px] text-muted tnum">Needs 2 weeks of food logged and 6 weigh-ins in the last 4 weeks (so far {days} days, {weighIns} weigh-ins). Until then, your target stays as it is.</p>
      )}
      <TextInput label={`Lose this much a week (${u})`} type="number" inputMode="decimal" min="0" max={units === 'imperial' ? '2' : '1'} step={units === 'imperial' ? '0.25' : '0.1'}
        defaultValue={String(kgTo(rate, units))} help="0 to keep your weight. Up to about 1% of your weight a week is usual."
        onBlur={async (ev) => { const v = Number(ev.target.value); if (ev.target.value.trim() === '' || !(v >= 0)) return; await setSetting('lossRateKgWeek', Math.min(1, toKg(v, units))); await setSetting('energyAutoAt', 0); await updateCalorieTarget(); }} />
    </div>
  );
}

/** Protein, carbs and fat as grams with a bar each (share of energy). */
export function MacroSplit({ n, withProtein = true }: { n: Nutrients; withProtein?: boolean }) {
  const p = (n.protein ?? 0) * 4, c = (n.carbs ?? 0) * 4, f = (n.fat ?? 0) * 9;
  const sum = p + c + f;
  const rows: [string, string, number][] = [...(withProtein ? [['Protein', 'protein', p] as [string, string, number]] : []), ['Carbs', 'carbs', c], ['Fat', 'fat', f],
    ...(withProtein ? [] : [['Fibre', 'fibre', -1] as [string, string, number]])];
  return (
    <div className="grid grid-cols-3 gap-3">
      {rows.map(([label, k, e]) => (
        <div key={k} className="min-w-0">
          <p className="text-[12px] text-muted">{label}</p>
          <p className="text-[17px] font-semibold tnum">{fmtNutrient(k, n[k] ?? 0)}</p>
          {e >= 0 && <Bar value={sum ? e : 0} max={sum || 1} height={4} label={`${label}: ${sum ? Math.round((e / sum) * 100) : 0}% of energy`} />}
        </div>
      ))}
    </div>
  );
}

function EditLogSheet({ log, energy, onClose }: { log: FoodLog; energy: EnergyUnit; onClose: () => void }) {
  const toast = useToast();
  const date = format(new Date(log.at), 'yyyy-MM-dd');
  const [s, setS] = useState(String(log.servings));
  return (
    <Sheet open onClose={onClose} title={log.name}>
      <div className="space-y-4">
        <p className="text-sm text-muted tnum">{fmtTime(Date.parse(log.at))}</p>
        <TextInput label="How many (servings, or the meal's size: 1 = usual)" type="number" inputMode="decimal" min="0.1" step="0.25" value={s} onChange={(e) => setS(e.target.value)} />
        <NutrientList n={Number(s) > 0 ? scaleNutrients(log.nutrients, Number(s) / log.servings) : log.nutrients} energy={energy} />
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!(Number(s) > 0) || Number(s) === log.servings} onClick={async () => { await changeServings(log, Number(s), date); toast('Saved'); onClose(); }}>Save</Button>
          <Button variant="danger" className="w-full" onClick={async () => { await removeFoodLog(log, date); toast(`Removed ${log.name}`, { onAction: () => restoreFoodLog(log, date) }); onClose(); }}>Remove</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

type Item = { name: string; amount: string; nutrients: Nutrients };

/** A batch you cook: what went in (scan the packs, pick saved foods, or type), and how many serves it makes. */
function RecipeSheet({ recipe, foods, energy, onClose }: { recipe?: Food; foods: Food[]; energy: EnergyUnit; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(recipe?.name ?? '');
  const [serves, setServes] = useState(String(recipe?.recipe?.serves ?? 4));
  const [items, setItems] = useState<Item[]>(recipe?.recipe?.items ?? []);
  const [adding, setAdding] = useState<Food | null>(null);
  const [amount, setAmount] = useState('1');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const scanInput = useRef<HTMLInputElement>(null);
  const [live, setLive] = useState(false);
  const total = useMemo(() => addNutrients(...items.map((i) => i.nutrients)), [items]);
  const per = Number(serves) > 0 ? scaleNutrients(total, 1 / Number(serves)) : total;
  const byWeight = !!adding?.per100;

  const scan = async (file?: File) => {
    if (!file) return;
    const code = await readBarcode(file).catch(() => null);
    if (!code) { toast("Couldn't read a barcode. Try again, or pick a saved food."); return; }
    await addCode(code);
  };
  const addCode = async (code: string) => {
    setBusy(true);
    try {
      const known = await foodByBarcode(code);
      if (known) { setAdding(known); return; }
      const r = await lookUpBarcode(code);
      if (!r.ok) { toast(r.reason === 'offline' ? "Couldn't reach the food database." : 'Not in the food database. Log it with a label photo first, then add it here.'); return; }
      const p = r.product;
      setAdding(await saveFood({ kind: 'product', name: p.name, brand: p.brand, barcode: code, serving: p.serving, servingQty: p.servingQty, servingUnit: p.servingUnit, per100: p.per100, nutrients: p.nutrients, source: 'openfoodfacts' }));
    } finally { setBusy(false); }
  };
  const add = () => {
    if (!adding) return;
    const a = Number(amount);
    if (!(a > 0)) return;
    const nutrients = byWeight ? scaleNutrients(adding.per100!, a / 100) : scaleNutrients(adding.nutrients, a);
    setItems([...items, { name: adding.name, amount: byWeight ? `${a} ${adding.servingUnit ?? 'g'}` : `${frac(a)} × ${adding.serving ?? 'serving'}`, nutrients }]);
    setAdding(null); setAmount('1');
  };
  const save = async () => {
    const data = { kind: 'recipe' as const, name: name.trim(), nutrients: per, serving: `1 of ${serves} serves`, recipe: { items, serves: Number(serves) }, source: 'recipe' as const };
    if (recipe) await updateFood(recipe.id, data); else await saveFood(data);
    toast(`Saved ${name.trim()}. Log a serve from Log food.`);
    onClose();
  };
  const matches = foods.filter((f) => !pick.trim() || f.name.toLowerCase().includes(pick.trim().toLowerCase())).slice(0, 8);

  return (
    <Sheet open onClose={onClose} title={recipe ? 'Edit recipe' : 'New batch recipe'}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Enter what goes in the pot once. Each time you eat it, log a serve.</p>
        <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Beef chilli" />
        <TextInput label="Serves" type="number" inputMode="numeric" min="1" step="1" value={serves} onChange={(e) => setServes(e.target.value)} />
        <div>
          <p className="font-medium mb-1">What goes in</p>
          {items.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : (
            <ul className="divide-y divide-border">
              {items.map((i, k) => (
                <li key={k} className="flex items-center gap-2 min-h-[48px]">
                  <span className="flex-1 min-w-0"><span className="block truncate">{i.name}</span><span className="block text-sm text-muted tnum">{i.amount} · {macroLine(i.nutrients, energy)}</span></span>
                  <button type="button" aria-label={`Remove ${i.name}`} onClick={() => setItems(items.filter((_, j) => j !== k))} className="w-11 h-11 flex items-center justify-center text-muted"><Trash2 size={18} aria-hidden="true" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {adding ? (
          <div className="rounded-btn bg-surface-2 p-3 space-y-3">
            <p className="font-medium">{adding.name}</p>
            <TextInput label={byWeight ? `How much (${adding.servingUnit ?? 'g'})` : `How many (${adding.serving ?? 'servings'})`} type="number" inputMode="decimal" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <div className="grid grid-cols-2 gap-2"><Button onClick={add}>Add</Button><Button variant="secondary" onClick={() => setAdding(null)}>Cancel</Button></div>
          </div>
        ) : (
          <div className="space-y-2">
            <input ref={scanInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void scan(e.target.files?.[0]); e.target.value = ''; }} />
            <Button variant="secondary" className="w-full flex items-center justify-center gap-2" disabled={busy} onClick={() => setLive(true)}><Barcode size={18} aria-hidden="true" /> {busy ? 'Looking it up…' : 'Scan a pack'}</Button>
            {live && <LiveScanner onClose={() => setLive(false)} onCode={(code) => { setLive(false); void addCode(code); }}
              onPhoto={() => { setLive(false); scanInput.current?.click(); }} onType={() => setLive(false)} />}
            <TextInput label="Or pick something saved" value={pick} onChange={(e) => setPick(e.target.value)} placeholder="Search" />
            <ul className="divide-y divide-border">
              {matches.map((f) => <li key={f.id}><button type="button" className="w-full min-h-[48px] text-left" onClick={() => { setAdding(f); setAmount(f.per100 ? String(f.servingQty ?? 100) : '1'); }}>{f.name}<span className="text-sm text-muted"> · {f.serving ?? ''}</span></button></li>)}
            </ul>
          </div>
        )}
        {items.length > 0 && (
          <div className="rounded-btn bg-surface-2 p-3">
            <p className="font-semibold tnum">Each serve: {macroLine(per, energy)}</p>
            <p className="text-sm text-muted tnum">Whole batch: {macroLine(total, energy)}</p>
          </div>
        )}
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!name.trim() || !items.length || !(Number(serves) >= 1)} onClick={save}>Save recipe</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** Today: energy and macros so far, and Log food. */
export function FoodToday({ personId, energy, target, now }: { personId: string; energy: EnergyUnit; target: number | null; now: number }) {
  const logs = useLive(() => db.foodLogs.where('at').aboveOrEqual(new Date(new Date(now).setHours(0, 0, 0, 0)).toISOString()).toArray(), [Math.floor(now / 3_600_000)]);
  const [logging, setLogging] = useState(false);
  if (!logs) return null;
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const tot = totalsFor(logs.filter((l) => personOf(l) === personId), start.getTime(), start.getTime() + 2 * 86_400_000);
  const n = logs.filter((l) => !l.deletedAt && personOf(l) === personId).length;
  return (
    <section className="box space-y-3" aria-labelledby="food-h">
      <div className="flex items-center gap-3">
        <h2 id="food-h" className="flex-1 font-medium">Food</h2>
        <a href="#/food" className="min-h-[44px] flex items-center text-sm text-muted underline underline-offset-4">{n ? `${n} logged` : 'Details'}</a>
        <Button variant="secondary" onClick={() => setLogging(true)}>Log food</Button>
      </div>
      {n > 0 && (
        <>
          <p className="tnum text-[15px]"><span className="text-[22px] font-semibold">{fmtEnergy(tot.kcal ?? 0, energy)}</span>{target ? <span className="text-muted"> of {fmtEnergy(target, energy)}</span> : null}</p>
          <MacroSplit n={tot} withProtein={false} />
          <p className="text-xs text-muted">Protein from food is in your protein below.</p>
        </>
      )}
      {logging && <LogFoodSheet personId={personId} energy={energy} onClose={() => setLogging(false)} />}
    </section>
  );
}

