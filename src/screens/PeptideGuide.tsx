// The peptide guide (peptide tools): every peptide in one list with the basics of mixing and injecting, and a page for
// each: what it is, what the research shows and what people notice, a mixing table for its usual vials, how it's taken,
// the doses used, storage, side effects, when to get help, and one tap to set it up. Neutral and factual throughout.
// The list filters by goal and searches; a page shows "Yours" (the person's own dose, progress and record) once it's set
// up, and what it's commonly combined with or kept apart from, checked against what they take now.
import { useState } from 'react';
import { AlertTriangle, BookOpen, Calculator, ChevronDown, ChevronRight, FlaskConical, Layers, Plus, Snowflake, Sparkles, Syringe } from 'lucide-react';
import { BASICS, canSplit, fmtDose, GOALS, guideById, guideFor, mixTable, searchGuide, splitView, stackChecks, type Goal, type GuideEntry } from '../logic/peptideGuide';
import { guideYours } from '../logic/guideYours';
import { SwingBars } from '../components/SwingBars';
import { fmtMl } from '../logic/peptide';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useMeds, useScheduleSettings } from '../app/data';
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
    <section aria-labelledby={hid} className="border-t border-border pt-4">
      <h2 id={hid} className="text-sm font-medium text-muted flex items-center gap-1.5 mb-2">{Icon && <Icon size={16} aria-hidden="true" />}{title}</h2>
      {children}
    </section>
  );
}


function GuidePage({ g }: { g: GuideEntry }) {
  const mine = useMine(g);
  const [vi, setVi] = useState('0');
  const vial = g.vials[Number(vi)] ?? g.vials[0];
  const rows = mixTable(g, vial);
  const per = vial.amount / vial.waterMl;
  return (
    <div className="space-y-4 pb-8">
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
        {g.vials.length > 1 && <ChipPicker label="Vial size" value={vi} onChange={setVi} options={g.vials.map((v, i) => ({ value: String(i), label: `${fmtDose(v.amount, g.unit)} vial` }))} />}
        <p className="mt-2 tnum">Add <strong>{v(vial.waterMl)} mL</strong> of bacteriostatic water to a {fmtDose(vial.amount, g.unit)} vial: {fmtDose(per, g.unit)} per mL.</p>
        <table className="mt-2 w-full text-left tnum">
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
        <p className="mt-2 text-sm text-muted">Once it’s set up, the app works out the draw from your own vial and water every time you log a shot.</p>
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
        {g.steps && (
          <ol className="mt-1 rounded-card bg-surface-2 p-3 space-y-1.5 tnum" aria-label="Step-up, weekly amount">
            <li className="text-sm text-muted">Step-up (weekly amount)</li>
            {g.steps.map((s, i) => {
              const start = g.steps!.slice(0, i).reduce((a, x) => a + x.weeks, 0) + 1;
              const d = s.amount <= vial.amount ? mixTable({ ...g, tableDoses: [s.amount] }, vial)[0] : undefined;
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
