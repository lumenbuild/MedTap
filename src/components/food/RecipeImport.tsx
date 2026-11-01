// A recipe from anywhere: shared to the app or pasted as a link (any site that publishes its recipe, which is most),
// a screenshot of its nutrition or its ingredients, or ingredients typed or pasted in. With no nutrition given, it's
// estimated from the ingredients. Each recipe is saved with its link, so sharing it again goes straight to logging.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ClipboardList, Image as ImageIcon } from 'lucide-react';
import { fetchRecipe } from '../../app/recipeFetch';
import { readText } from '../../app/ocr';
import { useToast } from '../../app/toast';
import { foodBySourceUrl, saveFood } from '../../db/repos/food';
import type { Food } from '../../db/schema';
import { fmtEnergy, fmtNutrient, parsePanel, type EnergyUnit } from '../../logic/nutrition';
import { estimateRecipe, ingredientLines, looksLikeIngredients, readLine, tbspFor, type EstimatedLine } from '../../logic/recipeEstimate';
import { extractUrl, normUrl } from '../../logic/recipeImport';
import { Button } from '../ui/Button';
import { TextArea, TextInput } from '../ui/Field';
import { Sheet, SheetActions } from '../ui/Sheet';
import { Stepper } from '../ui/Stepper';
import { Bar } from '../ui/Visual';
import type { Draft } from './draft';

interface Seed { name: string; lines: string[]; serves: number; servesKnown: boolean; sourceUrl?: string; tbsp: number; from: 'page' | 'typed' | 'screenshot' }

/** "https://…/recipes/one-pan-mexican-chicken" → "One pan mexican chicken". */
function nameFromUrl(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean).reverse().find((p) => /[a-z]-[a-z]/i.test(p)) ?? '';
    const s = decodeURIComponent(seg).replace(/\.\w+$/, '').replace(/-\d+$/, '').replace(/[-_]+/g, ' ').trim();
    return s ? s[0].toUpperCase() + s.slice(1) : '';
  } catch { return ''; }
}

const recipeDraft = (name: string, serves: number | undefined, n: Food['nutrients'], ingredients: string[], sourceUrl?: string): Draft => ({
  name, serving: serves ? `1 of ${serves} serves` : '1 serve', nutrients: n, source: 'web', kind: 'recipe', recipe: { items: [], serves: serves ?? 1, ingredients }, sourceUrl,
});

export function RecipeStep({ url: given, energy, onBack, onClose, onFound, onSaved }: {
  url?: string; energy: EnergyUnit; onBack: () => void; onClose: () => void; onFound: (d: Draft, note: string) => void; onSaved: (f: Food) => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState(given ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  // The link being imported (kept when the page can't be read, so a pasted or screenshot version still saves with it).
  const [link, setLink] = useState<{ key: string; name: string; tbsp: number } | null>(null);
  const [est, setEst] = useState<Seed | null>(null);
  const [typing, setTyping] = useState(false);
  const shot = useRef<HTMLInputElement>(null);

  const get = async (u: string) => {
    const l = extractUrl(u);
    if (!l) { setMsg('That doesn’t look like a web address.'); return; }
    const key = normUrl(l);
    const before = await foodBySourceUrl(key);
    if (before) { toast(`${before.name}: saved before, so it’s ready to log.`); onSaved(before); return; }
    const here = { key, name: nameFromUrl(l), tbsp: tbspFor(l) };
    setLink(here);
    setBusy('Getting the recipe…'); setMsg(null);
    const r = await fetchRecipe(l);
    setBusy(null);
    if (!r.ok) {
      setMsg(r.reason === 'web' ? 'Links work in the Android app. Here, paste the ingredients or use a screenshot.'
        : r.reason === 'blocked' ? 'That site didn’t let the app read the page. Paste the ingredients, or screenshot the nutrition or the ingredient list. It’s saved with this link either way.'
        : r.reason === 'offline' ? 'Couldn’t reach the page. Check the connection, or paste the ingredients.' : 'That page wasn’t found.');
      return;
    }
    const g = r.recipe;
    const name = g.name !== 'Recipe' ? g.name : here.name || 'Recipe';
    setLink({ ...here, name });
    if (g.perServe) { onFound(recipeDraft(name, g.serves, g.perServe, g.ingredients, key), `From the recipe page${g.serves ? ` (serves ${g.serves})` : ''}, per serve. Check the numbers.`); return; }
    if (g.ingredients.length >= 2) { setEst({ name, lines: g.ingredients, serves: g.serves ?? 4, servesKnown: !!g.serves, sourceUrl: key, tbsp: here.tbsp, from: 'page' }); return; }
    setMsg(`Found “${name}”, but the page shares neither its nutrition nor its ingredients in a form the app can read. Paste the ingredients, or use a screenshot.`);
  };
  useEffect(() => { if (given) void get(given); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fromShot = async (file?: File) => {
    if (!file) return;
    setBusy('Reading the screenshot on your phone…'); setMsg(null);
    try {
      const text = await readText(file, () => undefined);
      setBusy(null);
      const p = parsePanel(text);
      const per = Object.keys(p.perServing).length ? p.perServing : p.per100;
      if (per.kcal !== undefined || per.protein !== undefined) {
        onFound(recipeDraft(link?.name ?? '', undefined, per, [], link?.key), Object.keys(p.perServing).length ? 'Read from your screenshot, per serve. Check each number.' : 'Read from your screenshot (per 100 g). Check the numbers and the serve.');
        return;
      }
      if (looksLikeIngredients(text)) {
        const lines = ingredientLines(text).filter((l) => /^\s*[\d½¼¾⅓⅔]/.test(l) || readLine(l).as);
        setEst({ name: link?.name ?? '', lines, serves: 4, servesKnown: false, sourceUrl: link?.key, tbsp: link?.tbsp ?? 20, from: 'screenshot' });
        return;
      }
      setMsg('Couldn’t find nutrition or an ingredient list in that. Crop to one of them and try again.');
    } catch { setBusy(null); setMsg('Couldn’t read the screenshot. Try again with the nutrition or ingredients clearly in view.'); }
  };

  if (est) return <EstimateView seed={est} energy={energy} onBack={() => setEst(null)} onClose={onClose} onSaved={onSaved} />;
  if (typing) return <TypeIngredients name={link?.name ?? ''} onBack={() => setTyping(false)} onClose={onClose}
    onDone={(name, lines, serves) => { setTyping(false); setEst({ name, lines, serves, servesKnown: true, sourceUrl: link?.key, tbsp: link?.tbsp ?? 20, from: 'typed' }); }} />;

  return (
    <Sheet open onClose={onClose} title="Recipe">
      <div className="space-y-4">
        <input ref={shot} type="file" accept="image/*" className="hidden" onChange={(e) => { void fromShot(e.target.files?.[0]); e.target.value = ''; }} />
        <p className="text-sm text-muted">Any recipe site works: share it to MedTap, or paste its link. No nutrition on the page? It's worked out from the ingredients. Saved for one-tap logging next time.</p>
        <form className="flex gap-2 items-end" onSubmit={(e) => { e.preventDefault(); void get(url); }}>
          <div className="flex-1"><TextInput label="Recipe link" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
          <Button type="submit" disabled={!url.trim() || !!busy}>Get it</Button>
        </form>
        {busy && <p className="text-[15px] text-center" aria-live="polite">{busy}</p>}
        {msg && <p className="text-[15px] rounded-btn bg-surface-2 p-3" role="status">{msg}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setTyping(true)} className="min-h-[88px] rounded-card bg-surface-2 flex flex-col items-start justify-center gap-1.5 p-3 text-left">
            <ClipboardList size={22} className="text-primary" aria-hidden="true" />
            <span className="text-[14px] font-medium leading-tight">Paste or type ingredients</span>
            <span className="text-[12px] text-muted leading-tight">Your own recipes too</span>
          </button>
          <button type="button" onClick={() => shot.current?.click()} className="min-h-[88px] rounded-card bg-surface-2 flex flex-col items-start justify-center gap-1.5 p-3 text-left">
            <ImageIcon size={22} className="text-primary" aria-hidden="true" />
            <span className="text-[14px] font-medium leading-tight">Screenshot</span>
            <span className="text-[12px] text-muted leading-tight">Of the nutrition or the ingredients</span>
          </button>
        </div>
        <SheetActions><Button variant="secondary" className="w-full" onClick={onBack}>Back</Button></SheetActions>
      </div>
    </Sheet>
  );
}

function TypeIngredients({ name: given, onBack, onClose, onDone }: { name: string; onBack: () => void; onClose: () => void; onDone: (name: string, lines: string[], serves: number) => void }) {
  const [name, setName] = useState(given);
  const [text, setText] = useState('');
  const [serves, setServes] = useState(4);
  const lines = ingredientLines(text);
  return (
    <Sheet open onClose={onClose} title="Ingredients">
      <div className="space-y-4">
        <TextInput label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mum’s lasagne" />
        <TextArea label="Ingredients, one per line" rows={8} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'500g beef mince\n1 onion\n2 x 400g cans diced tomatoes\n250g dried lasagne sheets\n1 cup grated cheese'}
          help="Amounts as you'd write them: grams, cups, spoons, cans, or how many." />
        <div><p className="font-medium mb-1.5">Serves</p><Stepper label="Serves" value={serves} onChange={setServes} min={1} /></div>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={lines.length < 1 || !(serves >= 1)} onClick={() => onDone(name.trim(), lines, Math.round(serves))}>Work out the nutrition</Button>
          <Button variant="secondary" className="w-full" onClick={onBack}>Back</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

const why = (l: EstimatedLine) => (l.skip === 'no-amount' ? 'No amount: log it separately' : l.skip === 'unknown' ? 'Not recognised' : '');

/** The estimate: per serve, how sure, and each ingredient (tap one to leave it out). */
function EstimateView({ seed, energy, onBack, onClose, onSaved }: { seed: Seed; energy: EnergyUnit; onBack: () => void; onClose: () => void; onSaved: (f: Food) => void }) {
  const toast = useToast();
  const [name, setName] = useState(seed.name);
  const [serves, setServes] = useState(seed.serves);
  const [out, setOut] = useState<Set<number>>(new Set());
  const e = useMemo(() => estimateRecipe(seed.lines, Number.isFinite(serves) ? serves : 1, { tbspMl: seed.tbsp, leaveOut: out }), [seed, serves, out]);
  const p = e.perServe;
  const toggle = (i: number) => setOut((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const shown = e.lines.map((l, i) => ({ l, i })).filter(({ l }) => l.skip !== 'minor');
  const minor = e.lines.filter((l) => l.skip === 'minor' && l.as).length;
  const save = async () => {
    const items = e.lines.flatMap((l, i) => (l.nutrients && !out.has(i) ? [{ name: l.line, amount: `${Math.round(l.grams ?? 0)} g`, nutrients: l.nutrients }] : []));
    const food = await saveFood({ kind: 'recipe', name: name.trim() || 'Recipe', nutrients: p, serving: `1 of ${e.serves} serves`,
      recipe: { items, serves: e.serves, ingredients: seed.lines }, source: seed.sourceUrl ? 'web' : 'recipe', sourceUrl: seed.sourceUrl });
    toast(`Saved ${food.name}. It's in your foods for next time.`);
    onSaved(food);
  };
  const tile = (label: string, v: number | undefined, key: string) => (
    <div className="rounded-btn px-1 py-2 text-center" style={{ background: 'color-mix(in srgb, var(--hero-ink) 10%, transparent)' }}>
      <p className="text-[18px] font-bold tnum leading-tight">{v !== undefined ? fmtNutrient(key, v) : '–'}</p>
      <p className="text-[12px]">{label}</p>
    </div>
  );
  return (
    <Sheet open onClose={onClose} title="From the ingredients">
      <div className="space-y-4">
        <TextInput label="Name" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="e.g. One pan Mexican chicken" />
        <section className="hero body" aria-label="Estimated nutrition per serve">
          <p className="hero-label">A serve, estimated</p>
          <p className="text-[36px] leading-[40px] font-bold tnum mt-1">{fmtEnergy(p.kcal ?? 0, energy)}</p>
          <div className="grid grid-cols-4 gap-1.5 mt-3">
            {tile('Protein', p.protein, 'protein')}{tile('Carbs', p.carbs, 'carbs')}{tile('Fat', p.fat, 'fat')}{tile('Fibre', p.fibre, 'fibre')}
          </div>
          <p className="text-[13px] mt-2 tnum">Sodium {p.sodium !== undefined ? fmtNutrient('sodium', p.sodium) : '–'} · sugars {p.sugars !== undefined ? fmtNutrient('sugars', p.sugars) : '–'} · sat fat {p.satFat !== undefined ? fmtNutrient('satFat', p.satFat) : '–'}</p>
        </section>
        <div>
          <p className="font-medium mb-1.5">Serves</p>
          <Stepper label="Serves" value={serves} onChange={setServes} min={1} />
          {!seed.servesKnown && seed.from !== 'typed' && <p className="text-[13px] text-muted mt-1">The recipe didn't say. Check it: it divides everything.</p>}
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <p className="font-medium">Ingredients</p>
            <p className="text-[13px] text-muted tnum">{e.counted} of {e.of} counted</p>
          </div>
          <Bar value={e.counted} max={Math.max(1, e.of)} tone={e.counted / Math.max(1, e.of) >= 0.85 ? 'good' : 'watch'} label={`${e.counted} of ${e.of} ingredients counted`} />
          <ul className="mt-2 divide-y divide-border">
            {shown.map(({ l, i }) => {
              const counted = !!l.nutrients;
              const on = counted && !out.has(i);
              return (
                <li key={i}>
                  {counted ? (
                    <button type="button" role="checkbox" aria-checked={on} onClick={() => toggle(i)} className="w-full min-h-[52px] py-2 flex items-center gap-3 text-left">
                      <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 border ${on ? 'bg-primary border-primary text-on-primary' : 'border-border-strong'}`} aria-hidden="true">{on && <Check size={16} />}</span>
                      <span className={`flex-1 min-w-0 ${on ? '' : 'text-muted line-through'}`}>
                        <span className="block text-[15px] leading-snug">{l.line}</span>
                        <span className="block text-[12px] text-muted tnum">{l.as} · {Math.round(l.grams ?? 0)} g · P {fmtNutrient('protein', Math.round((l.nutrients!.protein ?? 0) * 10) / 10)}</span>
                      </span>
                      <span className="text-[14px] font-medium tnum shrink-0">{fmtEnergy(l.nutrients!.kcal ?? 0, energy)}</span>
                    </button>
                  ) : (
                    <div className="min-h-[52px] py-2 flex items-center gap-3">
                      <span className="w-6 h-6 rounded-md border border-dashed border-border-strong shrink-0" aria-hidden="true" />
                      <span className="flex-1 min-w-0">
                        <span className="block text-[15px] leading-snug text-muted">{l.line}</span>
                        <span className="block text-[12px] text-caution">{why(l)}</span>
                      </span>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {minor > 0 && <p className="text-[13px] text-muted mt-1">{minor} more (herbs, salt and pepper, water) too little to count.</p>}
        </div>
        <p className="text-[13px] text-muted">Typical values for each ingredient, so it's a close estimate rather than exact. Rough is fine: your calorie target corrects itself from your weigh-ins.</p>
        <SheetActions>
          <Button className="w-full min-h-[56px]" disabled={!(serves >= 1) || !e.counted} onClick={save}>Save recipe and log a serve</Button>
          <Button variant="secondary" className="w-full" onClick={onBack}>Back</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}
