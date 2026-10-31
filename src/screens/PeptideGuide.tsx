// The peptide guide (peptide tools). The list: yours first, then grouped by what each is for, one line each (how often,
// what for), with search and a goal filter, and the basics of mixing and injecting. A page: the numbers that matter at a
// glance (dose, how often, half-life, the mix and the draw, storage), then four sections: Overview (yours, what people
// notice, combining), Dosing (a tap-through mixer, doses, step-up, split, how it's taken), Safety (get help, side
// effects, worth knowing, blood tests) and Research (findings as cards, sources). Neutral and factual throughout.
import { useState } from 'react';
import { AlertTriangle, BookOpen, Calculator, ChevronDown, ChevronRight, FlaskConical, Layers, Plus, Snowflake, Sparkles, Syringe, TestTube } from 'lucide-react';
import { BASICS, blendParts, canSplit, fmtDose, GOALS, guideById, guideFor, halfLifeText, howOften, mixTable, searchGuide, splitView, stackChecks, type Goal, type GuideEntry } from '../logic/peptideGuide';
import { DrawResult } from '../components/Syringe';
import { guideYours } from '../logic/guideYours';
import { guideCourse } from '../logic/courseShop';
import { labsFor } from '../logic/peptideLabs';
import { experimentFor } from '../logic/experiments';
import { SwingBars } from '../components/SwingBars';
import { drawFor, fmtMl } from '../logic/peptide';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useLabs, useMeds, useScheduleSettings, useSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { medIsFor, personOf } from '../db/repos/people';
import { go, replace } from '../app/router';
import type { Medication } from '../db/schema';
import { Button } from '../components/ui/Button';
import { ChipPicker, Segmented, TextInput } from '../components/ui/Field';

/** The person's own medication set up from this entry, if there is one. */
function useMine(g?: GuideEntry) {
  const meds = useMeds(); const fam = useFamily();
  if (!g || !meds || !fam) return undefined;
  return meds.find((m) => !m.archived && medIsFor(m, fam.personId) && guideFor(m.name)?.id === g.id);
}

export type GuideSection = 'overview' | 'dosing' | 'safety' | 'research';

export function PeptideGuide({ id, section }: { id?: string; section?: GuideSection }) {
  const g = id ? guideById(id) : undefined;
  return g ? <GuidePage g={g} section={section} /> : <GuideList />;
}

/** "Weekly · Weight": how often and what for, the list's one line. */
const tagLine = (g: GuideEntry) => [howOften(g), ...(g.goals ?? []).slice(0, 2).map((x) => GOALS.find((y) => y.id === x)!.label)].join(' · ');

function GuideList() {
  const meds = useMeds(); const fam = useFamily();
  const [q, setQ] = useState('');
  const [goal, setGoal] = useState<Goal | 'all'>('all');
  const mine = new Set((meds ?? []).filter((m) => !m.archived && fam && medIsFor(m, fam.personId)).map((m) => guideFor(m.name)?.id).filter(Boolean));
  const list = searchGuide(q, goal === 'all' ? undefined : goal);
  // Browsing everything: yours first, then by what each is mainly for. Searching or filtering: one list.
  const grouped = !q.trim() && goal === 'all';
  const groups = grouped
    ? [{ key: 'yours', title: 'Yours', items: list.filter((g) => mine.has(g.id)) },
      ...GOALS.map((x) => ({ key: x.id, title: x.label, items: list.filter((g) => !mine.has(g.id) && g.goals?.[0] === x.id) }))].filter((x) => x.items.length)
    : [{ key: 'all', title: '', items: list }];
  return (
    <div className="space-y-4 pb-8">
      <TextInput label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, brand or what it’s for" />
      <ChipPicker label="What it’s for" value={goal} onChange={setGoal} options={[{ value: 'all', label: 'All' }, ...GOALS.map((x) => ({ value: x.id, label: x.label }))]} />
      <p className="sr-only" aria-live="polite">{list.length} {list.length === 1 ? 'peptide' : 'peptides'}</p>
      {list.length === 0 && <p className="text-muted py-4">Nothing matches. The calculator works for any peptide.</p>}
      {groups.map((grp) => (
        <section key={grp.key} aria-label={grp.title || 'Peptides'}>
          {grp.title && <h2 className="text-sm font-medium text-muted mb-1">{grp.title}</h2>}
          <ul className="divide-y divide-border border-y border-border">
            {grp.items.map((g) => (
              <li key={g.id}>
                <a href={`#/guide/${g.id}`} className="flex items-center gap-3 py-2.5 min-h-[56px]">
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2"><span className="font-medium truncate">{g.name}</span>
                      {g.blend && <span className="text-[12px] text-muted font-medium">Blend</span>}
                      {mine.has(g.id) && grp.key !== 'yours' && <span className="text-[12px] text-success font-medium">Yours</span>}</span>
                    <span className="block text-sm text-muted truncate">{tagLine(g)}</span>
                  </span>
                  <ChevronRight size={18} className="text-muted shrink-0" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
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
    <ul className="space-y-2">
      {items.map((t) => {
        const m = DOSE_LABEL.exec(t);
        return (
          <li key={t} className="flex gap-2.5 leading-snug">
            <span aria-hidden="true" className="mt-[0.55em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tone === 'watch' ? 'var(--danger)' : 'var(--text-muted)' }} />
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
    <section aria-labelledby={hid} className="space-y-2">
      <h2 id={hid} className="text-sm font-medium text-muted flex items-center gap-1.5">{Icon && <Icon size={16} aria-hidden="true" />}{title}</h2>
      {children}
    </section>
  );
}

/** A finding as a card: a short lead ("Phase 2 trial (338 adults, 48 weeks)") in bold, then the rest. */
function Finding({ text }: { text: string }) {
  const i = text.indexOf(': ');
  const lead = i > 0 && i < 70 ? text.slice(0, i) : null;
  return <li className="rounded-card bg-surface-2 p-3 leading-snug">{lead ? <><span className="font-medium block">{lead}</span><span>{text.slice(i + 2)}</span></> : text}</li>;
}

/** The top of a guide page, the same on every section: what it's for, the numbers that matter, the mix, storage. */
function Glance({ g, mine }: { g: GuideEntry; mine?: Medication }) {
  const v0 = g.vials[0];
  const start = mixTable({ ...g, tableDoses: [g.setup.defaultAmount] }, v0)[0];
  const top = g.steps?.[g.steps.length - 1]?.amount;
  const hl = halfLifeText(g.halfLifeHours);
  const tiles = [
    { k: 'Dose', v: top ? rangeShort(g.setup.defaultAmount, top, g.unit) : fmtShort(g.setup.defaultAmount, g.unit), sub: top ? 'start → top step' : 'to start' },
    { k: 'How often', v: howOften(g), sub: canSplit(g) ? 'or split in two' : g.window ? `${clock(g.window[0])}–${clock(g.window[1])}` : undefined },
    hl ? { k: 'Half-life', v: hl, sub: g.tmaxHours ? `peaks ~${Math.round(g.tmaxHours)} h after` : undefined } : { k: 'Taken', v: g.route.split(/[:(.]/)[0], sub: undefined },
  ];
  const weeks = g.storage.useWithinDays % 7 === 0 ? `${g.storage.useWithinDays / 7} weeks` : `${g.storage.useWithinDays} days`;
  return (
    <section aria-label={`${g.name} at a glance`} className="space-y-3">
      <p className="leading-snug">{g.what}</p>
      <p className="flex flex-wrap gap-1.5">{(g.goals ?? []).map((x) => <span key={x} className="text-[12px] font-medium px-2.5 h-6 inline-flex items-center rounded-chip bg-surface-2">{GOALS.find((y) => y.id === x)?.label}</span>)}
        {g.aka.length > 0 && <span className="text-[12px] text-muted inline-flex items-center">Also {g.aka.join(', ')}</span>}</p>
      <dl className="grid grid-cols-3 gap-2">
        {tiles.map((t) => (
          <div key={t.k} className="rounded-card bg-surface-2 p-3 min-w-0">
            <dt className="text-[12px] text-muted">{t.k}</dt>
            <dd className="font-semibold leading-tight tnum break-words">{t.v}</dd>
            {t.sub && <dd className="text-[12px] text-muted leading-tight">{t.sub}</dd>}
          </div>
        ))}
      </dl>
      <div className="rounded-card border border-border p-3 space-y-1">
        <p className="tnum flex items-start gap-2"><Syringe size={16} aria-hidden="true" className="shrink-0 mt-1" />
          <span><span className="block">Mix {fmtShort(v0.amount, g.unit)} with {v(v0.waterMl)} mL water</span><strong className="block">{fmtShort(g.setup.defaultAmount, g.unit)} = {v(start.units)} units</strong></span></p>
        <p className="text-sm text-muted flex items-center gap-2"><Snowflake size={16} aria-hidden="true" className="shrink-0" />Fridge once mixed · use within {weeks}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {mine
          ? <Button className="min-h-[52px]" onClick={() => go(`/meds/${mine.id}`)}>Open yours</Button>
          : <Button className="min-h-[52px]" onClick={() => go(`/meds/new/guide/${g.id}`)}><Plus size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />Set it up</Button>}
        <Button variant="secondary" className="min-h-[52px]" onClick={() => go(`/calc/${g.id}`)}><Calculator size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />Calculator</Button>
      </div>
    </section>
  );
}
const fmtShort = (n: number, unit: string) => (unit === 'mg' && n < 1 ? `${Math.round(n * 1000)} mcg` : unit === 'mcg' && n >= 1000 ? `${Math.round(n / 100) / 10} mg` : `${Math.round(n * 1000) / 1000} ${unit}`);
/** "2 → 12 mg" when both are in the same unit once shortened, else both in full. */
const rangeShort = (a: number, b: number, unit: string) => { const x = fmtShort(a, unit), y = fmtShort(b, unit); const ux = x.split(' ')[1], uy = y.split(' ')[1]; return ux === uy ? `${x.split(' ')[0]} → ${y}` : `${x} → ${y}`; };
const clock = (h: number) => `${h % 12 || 12} ${h < 12 || h === 24 ? 'am' : 'pm'}`;

function GuidePage({ g, section }: { g: GuideEntry; section?: GuideSection }) {
  const mine = useMine(g);
  const tab: GuideSection = section ?? 'overview';
  const pick = (t: GuideSection) => replace(`/guide/${g.id}${t === 'overview' ? '' : `/${t}`}`);
  return (
    <div className="space-y-5 pb-8">
      <Glance g={g} mine={mine} />
      <div className="sticky top-0 z-20 -mx-6 px-6 py-2 bg-bg">
        <Segmented<GuideSection> label="Show" value={tab} onChange={pick}
          options={[{ value: 'overview', label: 'Overview' }, { value: 'dosing', label: 'Dosing' }, { value: 'safety', label: 'Safety' }, { value: 'research', label: 'Research' }]} />
      </div>

      {tab === 'overview' && <>
        {mine && <Yours g={g} med={mine} />}
        <Section title="What people notice" Icon={Sparkles}><Points items={g.notice} /></Section>
        <Stack g={g} selfId={mine?.id} />
        <TestThis g={g} />
      </>}

      {tab === 'dosing' && <>
        <Mixer g={g} />
        <Section title="Doses"><Points items={g.doses} /><CourseLine g={g} /></Section>
        {g.steps && (
          <Section title="Step-up">
            <ol className="rounded-card bg-surface-2 p-3 space-y-1.5 tnum" aria-label="Step-up, a dose each step">
              {g.steps.map((s, i) => {
                const start = g.steps!.slice(0, i).reduce((a, x) => a + x.weeks, 0) + 1;
                const d = s.amount <= g.vials[0].amount ? mixTable({ ...g, tableDoses: [s.amount] }, g.vials[0])[0] : undefined;
                return (
                  <li key={i} className="flex justify-between gap-3">
                    <span className="text-muted">{i === g.steps!.length - 1 ? `Week ${start} on` : `Weeks ${start}–${start + s.weeks - 1}`}</span>
                    <span><strong>{fmtDose(s.amount, g.unit)}</strong>{d ? <span className="text-muted"> · {v(d.units)} units</span> : ''}</span>
                  </li>
                );
              })}
            </ol>
          </Section>
        )}
        {canSplit(g) && (() => {
          const sv = splitView(g.halfLifeHours, [1], g.tmaxHours);
          return sv && (
            <Section title="Once or twice a week">
              <p className="leading-snug">The level drops between shots. Two half shots 3–4 days apart keep it steadier.</p>
              <SwingBars view={sv} />
            </Section>
          );
        })()}
        <Section title="How it’s taken">
          <dl className="divide-y divide-border">
            {[['Where', g.route], ['When', g.when], ...(g.cycle ? [['How long', g.cycle]] : []), ['Powder', g.storage.powder], ['Once mixed', g.storage.mixed]].map(([k, val]) => (
              <div key={k} className="grid grid-cols-[6.5rem_1fr] gap-3 py-2"><dt className="text-sm text-muted">{k}</dt><dd className="leading-snug">{val}</dd></div>
            ))}
          </dl>
        </Section>
        {g.tips.length > 0 && <Section title="Tips"><Points items={g.tips} /></Section>}
      </>}

      {tab === 'safety' && <>
        <section aria-labelledby="g-help" className="rounded-card p-4 space-y-2" style={{ background: 'var(--danger-soft)' }}>
          <h2 id="g-help" className="font-semibold flex items-center gap-1.5"><AlertTriangle size={18} aria-hidden="true" style={{ color: 'var(--danger)' }} />Get help now if</h2>
          <Points items={g.getHelp} tone="watch" />
        </section>
        <Section title="Side effects"><Points items={g.sideEffects} /></Section>
        <Section title="Worth knowing"><Points items={g.worthKnowing} /></Section>
        <Labs g={g} />
      </>}

      {tab === 'research' && <>
        <Section title="What the research shows" Icon={FlaskConical}><ul className="space-y-2">{g.research.map((t) => <Finding key={t} text={t} />)}</ul></Section>
        <Section title="Sources">
          <ul className="space-y-1.5 text-sm text-muted">{g.sources.map((t) => <li key={t}>{t}</li>)}</ul>
          <a href="#/guide" className="min-h-[44px] inline-flex items-center text-sm font-medium underline underline-offset-4">The basics: supplies, mixing, injecting, checking a batch</a>
        </Section>
      </>}
    </div>
  );
}

/** Tap a vial size and a dose: the draw, on the syringe. "Every dose" opens the full table. */
function Mixer({ g }: { g: GuideEntry }) {
  const [vi, setVi] = useState('0');
  const [dose, setDose] = useState(String(g.setup.defaultAmount));
  const [table, setTable] = useState(false);
  const vial = g.vials[Number(vi)] ?? g.vials[0];
  const rows = mixTable(g, vial);
  const d = Number(dose) <= vial.amount ? drawFor(Number(dose), vial.amount, vial.waterMl, 'U-100') : null;
  const others = blendParts(g, Number(dose));
  return (
    <Section title="Mixing and drawing" Icon={Syringe}>
      {g.vials.length > 1 && <ChipPicker label="Vial size" value={vi} onChange={setVi} options={g.vials.map((x, i) => ({ value: String(i), label: `${fmtDose(x.amount, g.unit)} vial` }))} />}
      <p className="tnum">Add <strong>{v(vial.waterMl)} mL</strong> of bacteriostatic water: {fmtDose(vial.amount / vial.waterMl, g.unit)} per mL.</p>
      <ChipPicker label="Dose" value={dose} onChange={setDose} options={rows.map((r) => ({ value: String(r.dose), label: fmtShort(r.dose, g.unit) }))} />
      {d && <div className="rounded-card border border-border p-3"><DrawResult draw={d} capacity={g.setup.syringeUnits} syringe="U-100" />
        {others.length > 0 && <p className="text-sm text-muted mt-1">Each draw also has {others.map((o) => `${fmtDose(o.amount, g.unit)} ${o.name}`).join(' and ')}.</p>}</div>}
      <button type="button" aria-expanded={table} onClick={() => setTable((x) => !x)} className="min-h-[44px] text-sm font-medium underline underline-offset-4">{table ? 'Hide the table' : 'Every dose as a table'}</button>
      {table && (
        <table className="w-full text-left tnum">
          <caption className="sr-only">Draw for each dose on a U-100 insulin syringe</caption>
          <thead><tr className="text-sm text-muted"><th scope="col" className="font-normal py-1.5">Dose</th><th scope="col" className="font-normal py-1.5">Draw</th><th scope="col" className="font-normal py-1.5 text-right">Units</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.dose} className="border-t border-border">
              <th scope="row" className="font-medium py-2">{fmtDose(r.dose, g.unit)}</th>
              <td className="py-2 text-muted">{fmtMl(r.ml)}</td>
              <td className="py-2 text-right font-semibold">{v(r.units)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Section>
  );
}

const v = (n: number) => String(Math.round(n * 10) / 10);

/** At the starting dose: the shots, total and vials a course (or 4 weeks) takes. */
function CourseLine({ g }: { g: GuideEntry }) {
  const c = guideCourse(g);
  if (!c.shots) return null;
  return (
    <p className="rounded-card bg-surface-2 p-3 leading-snug tnum">
      <span className="font-medium">{c.course ? `A ${c.days}-day course` : '4 weeks'} at {fmtDose(g.setup.defaultAmount, g.unit)}:</span> {c.shots} shot{c.shots === 1 ? '' : 's'}, {fmtDose(c.total, g.unit)} in all, about {c.vials} vial{c.vials === 1 ? '' : 's'} of {fmtDose(g.vials[0].amount, g.unit)}.
    </p>
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
