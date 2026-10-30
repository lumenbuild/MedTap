// The peptide guide (peptide tools): every peptide in one list with the basics of mixing and injecting, and a page for
// each: what it is and where the evidence stands, a mixing table for its usual vials, how it's taken, the doses people
// report (labelled trial or user reports), storage, side effects, when to get help, and one tap to set it up.
import { useState } from 'react';
import { AlertTriangle, BookOpen, Calculator, ChevronDown, ChevronRight, FlaskConical, Plus, Snowflake, Syringe } from 'lucide-react';
import { BASICS, EVIDENCE, fmtDose, GUIDE, guideById, guideFor, mixTable, type GuideEntry } from '../logic/peptideGuide';
import { fmtMl } from '../logic/peptide';
import { useFamily, useMeds } from '../app/data';
import { medIsFor } from '../db/repos/people';
import { go } from '../app/router';
import { Button } from '../components/ui/Button';
import { ChipPicker } from '../components/ui/Field';

const EV_TONE = { trials: 'var(--success)', small: 'var(--primary)', animal: 'var(--caution)' } as const;

function EvidenceTag({ g }: { g: GuideEntry }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] font-medium rounded-chip bg-surface-2 px-2 py-0.5">
      <FlaskConical size={13} aria-hidden="true" style={{ color: EV_TONE[g.evidence] }} />{EVIDENCE[g.evidence].label}
    </span>
  );
}

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
  const mine = new Set((meds ?? []).filter((m) => !m.archived && fam && medIsFor(m, fam.personId)).map((m) => guideFor(m.name)?.id).filter(Boolean));
  return (
    <div className="space-y-5">
      <p className="text-muted">What each one is, how it’s mixed, taken and stored, the doses people report, and what to watch for. Tap one to read it or set it up.</p>
      <ul className="divide-y divide-border border-y border-border">
        {GUIDE.map((g) => (
          <li key={g.id}>
            <a href={`#/guide/${g.id}`} className="flex items-center gap-3 py-3 min-h-[64px]">
              <span className="flex-1 min-w-0">
                <span className="flex items-center gap-2 flex-wrap"><span className="font-medium">{g.name}</span><EvidenceTag g={g} />{mine.has(g.id) && <span className="text-[12px] text-success font-medium">Yours</span>}</span>
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
      <Footnote />
    </div>
  );
}

function Points({ items, tone }: { items: string[]; tone?: 'watch' }) {
  return (
    <ul className="pb-3 space-y-1.5">
      {items.map((t) => (
        <li key={t} className="flex gap-2.5 leading-snug">
          <span aria-hidden="true" className="mt-[0.55em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tone === 'watch' ? 'var(--caution)' : 'var(--text-muted)' }} />
          <span>{t}</span>
        </li>
      ))}
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

function Footnote() {
  return <p className="text-sm text-muted">For reference only. The doses are what’s been published or what people report, not advice for you. Check with a doctor before starting, especially if you take other medicines or have a health condition.</p>;
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
        <EvidenceTag g={g} />
        <p className="text-sm text-muted leading-snug">{g.status}</p>
        {g.aka.length > 0 && <p className="text-sm text-muted">Also called {g.aka.filter((a) => a.toLowerCase() !== g.id).join(', ')}.</p>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {mine
          ? <Button className="min-h-[52px]" onClick={() => go(`/meds/${mine.id}`)}>Open yours</Button>
          : <Button className="min-h-[52px]" onClick={() => go(`/meds/new/guide/${g.id}`)}><Plus size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />Set it up</Button>}
        <Button variant="secondary" className="min-h-[52px]" onClick={() => go('/calc')}><Calculator size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />Calculator</Button>
      </div>

      <Section title="Mixing and drawing" Icon={Syringe}>
        {g.vials.length > 1 && <ChipPicker label="Vial size" value={vi} onChange={setVi} options={g.vials.map((v, i) => ({ value: String(i), label: `${fmtDose(v.amount, g.unit)} vial` }))} />}
        <p className="mt-2 tnum">Add <strong>{v(vial.waterMl)} mL</strong> of bacteriostatic water to a {fmtDose(vial.amount, g.unit)} vial: {fmtDose(per, g.unit)} per mL.</p>
        <table className="mt-2 w-full text-left tnum">
          <caption className="sr-only">Draw for each dose on a U-100 insulin syringe</caption>
          <thead><tr className="text-sm text-muted"><th scope="col" className="font-normal py-1.5">Dose</th><th scope="col" className="font-normal py-1.5">Draw</th><th scope="col" className="font-normal py-1.5 text-right">U-100 units</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.dose} className="border-t border-border">
                <th scope="row" className="font-medium py-2">{fmtDose(r.dose, g.unit)}</th>
                <td className="py-2 text-muted">{fmtMl(r.ml)}</td>
                <td className="py-2 text-right font-semibold">{v(r.units)}{r.units > 100 ? ' (over 1 mL)' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-muted">Once it’s set up, the app works out the draw from your own vial and water every time you log a shot.</p>
      </Section>

      <Section title="How it’s taken">
        <dl className="space-y-2">
          <div><dt className="text-sm text-muted">Where</dt><dd>{g.route}</dd></div>
          <div><dt className="text-sm text-muted">When</dt><dd>{g.when}</dd></div>
          {g.cycle && <div><dt className="text-sm text-muted">How long</dt><dd>{g.cycle}</dd></div>}
        </dl>
      </Section>

      <Section title="Doses people report">
        <ul className="space-y-2">
          {g.reported.map((r) => (
            <li key={r.text} className="leading-snug">
              <span className={`mr-1.5 inline-block text-[11px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 align-[1px] ${r.source === 'trial' ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'}`}>{r.source === 'trial' ? 'Trial' : 'User reports'}</span>
              {r.text}
            </li>
          ))}
        </ul>
        {g.steps && (
          <ol className="mt-3 rounded-card bg-surface-2 p-3 space-y-1.5 tnum" aria-label="The trial step-up">
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

      <Section title="Storage" Icon={Snowflake}>
        <dl className="space-y-2">
          <div><dt className="text-sm text-muted">Powder</dt><dd>{g.storage.powder}</dd></div>
          <div><dt className="text-sm text-muted">Once mixed</dt><dd>{g.storage.mixed}</dd></div>
        </dl>
      </Section>

      <Section title="Side effects"><Points items={g.sideEffects} /></Section>
      <Section title="Get help now if" Icon={AlertTriangle}><Points items={g.getHelp} tone="watch" /></Section>
      <Section title="Check first"><Points items={g.checkFirst} /></Section>
      <Section title="Tips"><Points items={g.tips} /></Section>
      <Section title="Sources">
        <Points items={g.sources} />
        <a href="#/guide" className="min-h-[44px] inline-flex items-center text-sm font-medium underline underline-offset-4">The basics: supplies, mixing, injecting, quality</a>
      </Section>
      <Footnote />
    </div>
  );
}

const v = (n: number) => String(Math.round(n * 10) / 10);
