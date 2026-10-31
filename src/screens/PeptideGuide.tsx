// The peptide guide (peptide tools): every peptide in one list with the basics of mixing and injecting, and a page for
// each: what it is, what the research shows and what people notice, a mixing table for its usual vials, how it's taken,
// the doses used, storage, side effects, when to get help, and one tap to set it up. Neutral and factual throughout.
// The list filters by goal and searches; a page shows "Yours" (the person's own dose, progress and record) once it's set
// up, and what it's commonly combined with or kept apart from, checked against what they take now.
import { useState } from 'react';
import { AlertTriangle, BookOpen, Calculator, ChevronDown, ChevronRight, FlaskConical, Layers, Plus, Snowflake, Sparkles, Syringe, TestTube } from 'lucide-react';
import { BASICS, canSplit, firstPart, fmtDose, GOALS, guideById, guideFor, mixTable, savedVial, saveVial, searchGuide, splitView, stackChecks, suggestWater, type Goal, type GuideEntry, type GuideVial } from '../logic/peptideGuide';
import { guideYours } from '../logic/guideYours';
import { guideCourse } from '../logic/courseShop';
import { labsFor } from '../logic/peptideLabs';
import { experimentFor } from '../logic/experiments';
import { SwingBars } from '../components/SwingBars';
import { convert, fmtMl } from '../logic/peptide';
import { SyringeGauge } from '../components/Syringe';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useLabs, useMeds, useScheduleSettings, useSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { medIsFor, personOf } from '../db/repos/people';
import { go } from '../app/router';
import type { Medication } from '../db/schema';
import { Button } from '../components/ui/Button';
import { ChipPicker, TextInput } from '../components/ui/Field';

/** The person's own medication set up from this entry, if there is one. */
function useMine(g?: GuideEntry) {
  const meds = useMeds(); const fam = useFamily();
  if (!g || !meds || !fam) return undefined;
  return meds.find((m) => !m.archived && medIsFor(m, fam.personId) && guideFor(m.name)?.id === g.id);
}

export function PeptideGuide({ id }: { id?: string }) {
  const g = id ? guideById(id) : undefined;
  return g ? <GuidePage g={g} /> : <GuideList />;
}

function GuideList() {
  const meds = useMeds(); const fam = useFamily();
  const [q, setQ] = useState('');
  const [goal, setGoal] = useState<Goal | 'all' | 'mine'>('all');
  const mine = new Set((meds ?? []).filter((m) => !m.archived && fam && medIsFor(m, fam.personId)).map((m) => guideFor(m.name)?.id).filter(Boolean));
  const list = searchGuide(q, goal === 'all' || goal === 'mine' ? undefined : goal).filter((g) => goal !== 'mine' || mine.has(g.id));
  return (
    <div className="space-y-4">
      <p className="text-muted">What each one is, what the research shows, how it’s mixed, taken and stored, the doses used, and side effects. Tap one to read it or set it up.</p>
      <TextInput label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, brand or what it’s for" />
      <ChipPicker label="What it’s for" value={goal} onChange={setGoal}
        options={[{ value: 'all', label: 'All' }, ...(mine.size ? [{ value: 'mine' as const, label: 'Yours' }] : []), ...GOALS.map((x) => ({ value: x.id, label: x.label }))]} />
      <p className="sr-only" aria-live="polite">{list.length} {list.length === 1 ? 'peptide' : 'peptides'}</p>
      {list.length === 0 && <p className="text-muted py-4">Nothing matches. The calculator works for any peptide.</p>}
      <ul className="divide-y divide-border border-y border-border">
        {list.map((g) => (
          <li key={g.id}>
            <a href={`#/guide/${g.id}`} className="flex items-center gap-3 py-3 min-h-[64px]">
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{g.name}</span>
                  {g.blend && <span className="text-[12px] text-muted font-medium">Blend</span>}
                  {mine.has(g.id) && <span className="text-[12px] text-success font-medium">Yours</span>}
                </span>
                <span className="block text-sm text-muted line-clamp-2">{g.what}</span>
              </span>
              <ChevronRight size={18} className="text-muted shrink-0" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <section aria-labelledby="basics-h" className="space-y-1">
        <h2 id="basics-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><BookOpen size={16} aria-hidden="true" />The basics, for all of them</h2>
        {BASICS.map((b) => (
          <details key={b.title} className="group border-b border-border">
            <summary className="flex items-center justify-between min-h-[48px] cursor-pointer list-none font-medium">
              {b.title}<ChevronDown size={18} aria-hidden="true" className="text-muted transition-transform group-open:rotate-180" />
            </summary>
            <Points items={b.points} />
          </details>
        ))}
      </section>
    </div>
  );
}

/** Dose lines open with where the dose comes from ("Trials:", "Label:", "Common use:"): shown in bold. */
const DOSE_LABEL = /^(Trials|Label|Russian label|Common use|Starting low|Splitting|Lowest dose): /;

function Points({ items, tone }: { items: string[]; tone?: 'watch' }) {
  return (
    <ul className="pb-3 space-y-1.5">
      {items.map((t) => {
        const m = DOSE_LABEL.exec(t);
        return (
        <li key={t} className="flex gap-2.5 leading-snug">
          <span aria-hidden="true" className="mt-[0.55em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tone === 'watch' ? 'var(--caution)' : 'var(--text-muted)' }} />
          <span>{m ? <><strong className="font-semibold">{m[1]}:</strong> {t.slice(m[0].length)}</> : t}</span>
        </li>
        );
      })}
    </ul>
  );
}

function Section({ title, Icon, children }: { title: string; Icon?: typeof Syringe; children: React.ReactNode }) {
  const hid = `g-${title.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <section aria-labelledby={hid} className="box">
      <h2 id={hid} className="text-sm font-medium text-muted flex items-center gap-1.5 mb-2">{Icon && <Icon size={16} aria-hidden="true" />}{title}</h2>
      {children}
    </section>
  );
}


/** How often, in a word: "Weekly", "Daily", "Twice a day", "10-day course". */
function howOften(g: GuideEntry): string | undefined {
  const sc = g.setup.schedule('2026-01-05', 1);
  if (sc.type === 'interval') return sc.intervalHours ? `Every ${sc.intervalHours} h` : undefined;
  if (sc.type !== 'fixed') return 'As needed';
  const per = sc.slots?.length ?? 1;
  const base = sc.days?.length === 1 ? 'Weekly' : sc.days?.length ? `${sc.days.length}× a week` : per === 1 ? 'Daily' : per === 2 ? 'Twice a day' : `${per}× a day`;
  return sc.course ? `${base} · ${sc.course.days}-day course` : base;
}

/** The top of a guide: the starting dose (and, with your vial, the units to draw on a syringe), then quick facts. */
function GuideHero({ g, vial }: { g: GuideEntry; vial?: GuideVial }) {
  const d = vial && g.setup.defaultAmount <= vial.amount ? mixTable({ ...g, tableDoses: [g.setup.defaultAmount] }, vial)[0] : undefined;
  const half = g.halfLifeHours ? (g.halfLifeHours >= 48 ? `${Math.round(g.halfLifeHours / 24)}-day half-life` : `${Math.round(g.halfLifeHours)}-hour half-life`) : undefined;
  const facts = [howOften(g), half, `Fridge · ${g.storage.useWithinDays >= 28 ? `${Math.round(g.storage.useWithinDays / 7)} wks` : `${g.storage.useWithinDays} days`} mixed`].filter(Boolean) as string[];
  return (
    <>
      <section className="hero pep" aria-label={`Starting dose ${fmtDose(g.setup.defaultAmount, g.unit)}${d ? `, ${v(d.units)} units` : ''}`}>
        <p className="hero-label">Starting dose</p>
        <p className="mt-1 tnum"><span className="text-[52px] leading-[56px] font-bold tracking-[-0.03em]">{fmtDose(g.setup.defaultAmount, g.unit)}</span>
          {d && <span className="text-[24px] font-semibold ml-2">= {v(d.units)} units</span>}</p>
        {d ? <><div className="mt-2"><SyringeGauge units={d.units} capacity={d.units > 50 ? 100 : 50} onHero /></div>
          <p className="mt-1 text-muted text-[15px]">Your {fmtDose(vial!.amount, g.unit)} vial + {v(vial!.waterMl)} mL water</p></>
          : <p className="mt-1 text-muted text-[15px]">Add your vial under Mixing and drawing to see the units.</p>}
      </section>
      <ul className="flex flex-wrap gap-2" aria-label="At a glance">
        {facts.map((f) => <li key={f} className="min-h-[40px] px-3.5 rounded-full inline-flex items-center text-[15px] font-medium" style={{ background: 'var(--fill)' }}>{f}</li>)}
      </ul>
    </>
  );
}

function GuidePage({ g }: { g: GuideEntry }) {
  const mine = useMine(g);
  // Vial sizes vary by supplier: the mixing table uses the person's own vial (from their medicine, or as they enter it).
  const own: GuideVial | undefined = mine?.peptide?.waterMl && mine.strength ? (() => {
    const amount = convert(mine.strength, mine.unit, g.unit);
    return amount ? { amount, waterMl: mine.peptide!.waterMl! } : undefined;
  })() : undefined;
  // null until the person changes it here: then their own medicine's vial (once loaded), else the last one entered.
  const [edited, setEdited] = useState<GuideVial | undefined | null>(null);
  const vial = edited !== null ? edited : own ?? savedVial(g.id);
  return (
    <div className="space-y-4 pb-8">
      <GuideHero g={g} vial={vial} />
      <div className="space-y-2">
        <p className="text-[15px] leading-snug">{g.what}</p>
        {g.aka.length > 0 && <p className="text-sm text-muted">Also called {g.aka.join(', ')}.</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {mine
          ? <Button className="min-h-[52px]" onClick={() => go(`/meds/${mine.id}`)}>Open yours</Button>
          : <Button className="min-h-[52px]" onClick={() => go(`/meds/new/guide/${g.id}`)}><Plus size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />Set it up</Button>}
        <Button variant="secondary" className="min-h-[52px]" onClick={() => go('/calc')}><Calculator size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />Calculator</Button>
      </div>

      {mine && <Yours g={g} med={mine} />}
      <Stack g={g} selfId={mine?.id} />

      <Section title="Mixing and drawing" Icon={Syringe}>
        <MixVial key={edited === null ? `${own?.amount}/${own?.waterMl}` : 'edited'} g={g} vial={vial} own={edited === null && !!own}
          onChange={(v) => { setEdited(v); if (v) saveVial(g.id, v); }} />
      </Section>

      <Section title="What the research shows" Icon={FlaskConical}><Points items={g.research} /></Section>
      <Section title="What people notice" Icon={Sparkles}><Points items={g.notice} /></Section>

      <Section title="How it’s taken">
        <dl className="space-y-2">
          <div><dt className="text-sm text-muted">Where</dt><dd>{g.route}</dd></div>
          <div><dt className="text-sm text-muted">When</dt><dd>{g.when}</dd></div>
          {g.cycle && <div><dt className="text-sm text-muted">How long</dt><dd>{g.cycle}</dd></div>}
        </dl>
      </Section>

      <Section title="Doses">
        <Points items={g.doses} />
        <CourseLine g={g} vial={vial} />
        {g.steps && (
          <ol className="mt-1 rounded-card bg-surface-2 p-3 space-y-1.5 tnum" aria-label="Step-up, weekly amount">
            <li className="text-sm text-muted">Step-up (weekly amount)</li>
            {g.steps.map((s, i) => {
              const start = g.steps!.slice(0, i).reduce((a, x) => a + x.weeks, 0) + 1;
              const d = vial && s.amount <= vial.amount ? mixTable({ ...g, tableDoses: [s.amount] }, vial)[0] : undefined;
              return (
                <li key={i} className="flex justify-between gap-3">
                  <span className="text-muted">{i === g.steps!.length - 1 ? `Week ${start} on` : `Weeks ${start}–${start + s.weeks - 1}`}</span>
                  <span><strong>{fmtDose(s.amount, g.unit)}</strong>{d ? <span className="text-muted"> · {v(d.units)} units</span> : ''}</span>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {canSplit(g) && (() => {
        const sv = splitView(g.halfLifeHours, [1], g.tmaxHours);
        return sv && (
          <Section title="Once or twice a week">
            <p className="leading-snug">With a half-life of about {Math.round(g.halfLifeHours! / 24)} days, the level drops between shots. Splitting the week’s amount into two shots 3–4 days apart keeps it steadier.</p>
            <SwingBars view={sv} />
          </Section>
        );
      })()}

      <Section title="Storage" Icon={Snowflake}>
        <dl className="space-y-2">
          <div><dt className="text-sm text-muted">Powder</dt><dd>{g.storage.powder}</dd></div>
          <div><dt className="text-sm text-muted">Once mixed</dt><dd>{g.storage.mixed}</dd></div>
        </dl>
      </Section>

      <Section title="Side effects"><Points items={g.sideEffects} /></Section>
      <Labs g={g} />
      <TestThis g={g} />
      <Section title="Get help now if" Icon={AlertTriangle}><Points items={g.getHelp} tone="watch" /></Section>
      <Section title="Worth knowing"><Points items={g.worthKnowing} /></Section>
      <Section title="Tips"><Points items={g.tips} /></Section>
      <Section title="Sources">
        <Points items={g.sources} />
        <a href="#/guide" className="min-h-[44px] inline-flex items-center text-sm font-medium underline underline-offset-4">The basics: supplies, mixing, injecting, checking a batch</a>
      </Section>
    </div>
  );
}

const v = (n: number) => String(Math.round(n * 10) / 10);

/** At the starting dose: the shots, total and (with the person's vial size) vials a course (or 4 weeks) takes. */
function CourseLine({ g, vial }: { g: GuideEntry; vial?: GuideVial }) {
  const c = guideCourse(g, vial?.amount);
  if (!c.shots) return null;
  return (
    <p className="rounded-card bg-surface-2 p-3 leading-snug tnum">
      <span className="font-medium">{c.course ? `A ${c.days}-day course` : '4 weeks'} at {fmtDose(g.setup.defaultAmount, g.unit)}:</span> {c.shots} shot{c.shots === 1 ? '' : 's'}, {fmtDose(c.total, g.unit)} in all{vial ? `, about ${c.vials} of your ${fmtDose(vial.amount, g.unit)} vial${c.vials === 1 ? '' : 's'}` : ''}.
    </p>
  );
}

/** Mixing for the person's own vial: its size (each part, for a blend) and the water, then the draw for each dose.
 *  Common sizes are quick picks only. The same numbers open in the calculator. */
function MixVial({ g, vial, own, onChange }: { g: GuideEntry; vial?: GuideVial; own: boolean; onChange: (v: GuideVial | undefined) => void }) {
  // Vials are labelled in mg; the guide works in its own unit (mcg for some).
  const toG = (mg: number) => convert(mg, 'mg', g.unit) ?? mg;
  const toMg = (n: number) => convert(n, g.unit, 'mg') ?? n;
  const show = (n: number | undefined) => (n === undefined ? '' : String(Math.round(toMg(n) * 1000) / 1000));
  const [sizes, setSizes] = useState<string[]>(() => [show(vial?.amount), ...(g.blend ?? []).map((_, i) => show(vial?.parts?.[i]))]);
  const [water, setWater] = useState(vial ? String(vial.waterMl) : '');
  const [waterSet, setWaterSet] = useState(!!vial);
  const num = (x: string) => (x.trim() === '' ? NaN : Number(x));
  const update = (nextSizes: string[], nextWater: string, touched: boolean) => {
    const amount = toG(num(nextSizes[0]));
    let w = nextWater;
    if (!touched && amount > 0) { w = String(suggestWater(g, amount)); setWater(w); }
    const parts = (g.blend ?? []).map((_, i) => toG(num(nextSizes[i + 1])));
    const ok = amount > 0 && num(w) > 0 && parts.every((p) => p >= 0);
    onChange(ok ? { amount, waterMl: num(w), ...(g.blend ? { parts } : {}) } : undefined);
  };
  const setSize = (i: number, x: string) => { const n = sizes.map((v, k) => (k === i ? x : v)); setSizes(n); update(n, water, waterSet); };
  const pick = (c: GuideEntry['vials'][number]) => {
    const n = [show(c.amount), ...(g.blend ?? []).map((b) => show((b.amount * c.amount) / g.vials[0].amount))];
    setSizes(n); setWaterSet(false); update(n, '', false);
  };
  const names = [g.blend ? firstPart(g) : '', ...(g.blend ?? []).map((b) => b.name)];
  const rows = vial ? mixTable(g, vial) : [];
  const perVial = vial ? Math.floor(vial.amount / g.setup.defaultAmount + 1e-9) : 0;
  const openCalc = () => {
    if (vial) { try { sessionStorage.setItem('calcPreset', JSON.stringify({ vialMg: toMg(vial.amount), waterMl: vial.waterMl, dose: g.setup.defaultAmount, doseUnit: g.unit })); } catch { /* storage off */ } }
    go('/calc');
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{own ? 'From your vial. Change it here for a different one.' : 'Sizes differ between suppliers: use what’s on your vial’s label.'}</p>
      <div className="grid grid-cols-2 gap-3">
        {names.map((n, i) => (
          <TextInput key={i} label={n ? `${n} (mg)` : 'Your vial (mg)'} type="number" inputMode="decimal" min="0" step="any" value={sizes[i]} onChange={(e) => setSize(i, e.target.value)} />
        ))}
        <TextInput label="Water (mL)" type="number" inputMode="decimal" min="0" step="any" value={water}
          onChange={(e) => { setWater(e.target.value); setWaterSet(true); update(sizes, e.target.value, true); }} />
      </div>
      {g.vials.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Common:</span>
          {g.vials.map((c) => (
            <button key={c.amount} type="button" onClick={() => pick(c)} className="min-h-[36px] px-3 rounded-full text-sm font-medium" style={{ background: 'var(--fill)' }}>
              {fmtDose(c.amount, g.unit)}{g.blend ? ` + ${g.blend.map((b) => fmtDose((b.amount * c.amount) / g.vials[0].amount, g.unit)).join(' + ')}` : ''}
            </button>
          ))}
        </div>
      )}
      {vial ? (
        <>
          <p className="tnum">Add <strong>{v(vial.waterMl)} mL</strong> of bacteriostatic water: {fmtDose(vial.amount / vial.waterMl, g.unit)} per mL{perVial > 0 ? `, about ${perVial} starting dose${perVial === 1 ? '' : 's'} per vial` : ''}.</p>
          {rows.length > 0 ? (
            <table className="w-full text-left tnum">
              <caption className="sr-only">Draw for each dose on a U-100 insulin syringe</caption>
              <thead><tr className="text-sm text-muted"><th scope="col" className="font-normal py-1.5">Dose</th><th scope="col" className="font-normal py-1.5">Draw</th><th scope="col" className="font-normal py-1.5 text-right">U-100 units</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.dose} className="border-t border-border">
                    <th scope="row" className="font-medium py-2">{fmtDose(r.dose, g.unit)}{r.others.map((o) => <span key={o.name} className="block text-sm font-normal text-muted">+ {fmtDose(o.amount, g.unit)} {o.name}</span>)}</th>
                    <td className="py-2 text-muted">{fmtMl(r.ml)}</td>
                    <td className="py-2 text-right font-semibold">{v(r.units)}{r.units > 100 ? ' (over 1 mL)' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="text-muted">The usual doses are bigger than this vial.</p>}
        </>
      ) : <p className="text-muted">Enter your vial’s size to see the draw for each dose.</p>}
      <Button variant="secondary" onClick={openCalc}><Calculator size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />{vial ? 'Open these in the calculator' : 'Calculator'}</Button>
    </div>
  );
}

/** Blood tests worth checking, why, and the person's latest result for each. */
function Labs({ g }: { g: GuideEntry }) {
  const labs = useLabs(); const fam = useFamily();
  const mine = (labs ?? []).filter((l) => fam && personOf(l) === fam.personId);
  const l = labsFor(g, mine);
  if (!l) return null;
  return (
    <Section title="Blood tests worth checking" Icon={TestTube}>
      <p className="leading-snug mb-2">{l.why}</p>
      <ul className="space-y-1.5">
        {l.tests.map((t) => (
          <li key={t.label} className="flex justify-between gap-3 tnum">
            <span>{t.label}</span>
            <span className={t.latest ? 'text-right' : 'text-muted'}>{t.latest ? `${t.latest.value}${t.latest.unit ? ` ${t.latest.unit}` : ''} · ${new Date(`${t.latest.date}T12:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}` : 'None yet'}</span>
          </li>
        ))}
      </ul>
      <a href="#/labs" className="min-h-[44px] inline-flex items-center text-sm font-medium underline underline-offset-4">Add results</a>
    </Section>
  );
}

/** Biohacking tools: an on/off experiment for this one, in one tap. */
function TestThis({ g }: { g: GuideEntry }) {
  const st = useSettings();
  const e = experimentFor(g);
  if (!st?.biohackTools || !e) return null;
  return (
    <Section title="Test it on yourself" Icon={FlaskConical}>
      <p className="leading-snug">Days on and off in a random order, measured by {e.metric === 'deepMin' ? 'deep sleep from the watch' : e.metric === 'focus' ? 'your focus rating' : 'your energy rating'}. It shows whether it does something for you, not just on average.</p>
      <Button variant="secondary" className="mt-2 w-full min-h-[48px]" onClick={() => go(`/experiments/new/${g.id}`)}>Set up the experiment</Button>
    </Section>
  );
}

/** The person's own: dose and draw, progress, record. */
function Yours({ g, med }: { g: GuideEntry; med: Medication }) {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const body = useBodyEntries(); const ss = useScheduleSettings();
  const now = useNow(600_000);
  if (!meds || !doses || !checkIns || !daily || !body || !ss) return null;
  const who = personOf(med);
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === who;
  const lines = guideYours(g, med, { meds: meds.filter((m) => medIsFor(m, who)), doses, checkIns: checkIns.filter(me), daily: daily.filter(me), body: body.filter(me) }, now, ss[1]);
  return (
    <section aria-labelledby="g-yours" className="rounded-card bg-surface-2 p-4 space-y-2">
      <h2 id="g-yours" className="text-sm font-medium text-muted flex items-center gap-1.5"><Sparkles size={16} aria-hidden="true" className="text-primary" />Yours</h2>
      <Points items={lines} />
    </section>
  );
}

/** Commonly combined with, and kept apart from: against what the person takes now, then the general notes. */
function Stack({ g, selfId }: { g: GuideEntry; selfId?: string }) {
  const meds = useMeds(); const fam = useFamily();
  if (!g.with?.length && !g.notWith?.length) return null;
  const active = (meds ?? []).filter((m) => !m.archived && fam && medIsFor(m, fam.personId));
  const checks = stackChecks(g, active, selfId);
  const shown = new Set(checks.map((c) => c.ref));
  const withRest = (g.with ?? []).filter((w) => !shown.has(w.id)), notRest = (g.notWith ?? []).filter((w) => !shown.has(w.id));
  const name = (id: string) => (id === 'glp1' ? 'Another GLP-1 medicine' : guideById(id)?.name ?? id);
  const link = (id: string) => (guideById(id) ? <a href={`#/guide/${id}`} className="font-medium underline underline-offset-4">{name(id)}</a> : <span className="font-medium">{name(id)}</span>);
  return (
    <Section title="Combining" Icon={Layers}>
      {checks.length > 0 && (
        <ul className="mb-3 space-y-1.5" aria-label="With what you take">
          {checks.map((c) => (
            <li key={c.med} className="flex gap-2.5 leading-snug">
              <span aria-hidden="true" className="mt-[0.55em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.kind === 'notWith' ? 'var(--caution)' : 'var(--success)' }} />
              <span><span className="font-medium">You take {c.med}</span>: {c.kind === 'notWith' ? 'not usually combined' : 'commonly combined'}. {c.note}.</span>
            </li>
          ))}
        </ul>
      )}
      <dl className="space-y-2">
        {withRest.length ? <div><dt className="text-sm text-muted">{shown.size ? 'Also often combined with' : 'Often combined with'}</dt><dd className="space-y-1">{withRest.map((w) => <p key={w.id}>{link(w.id)}: {w.note}</p>)}</dd></div> : null}
        {notRest.length ? <div><dt className="text-sm text-muted">Not usually combined with</dt><dd className="space-y-1">{notRest.map((w) => <p key={w.id}>{link(w.id)}: {w.note}</p>)}</dd></div> : null}
      </dl>
    </Section>
  );
}
