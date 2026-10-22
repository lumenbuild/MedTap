import { format } from 'date-fns';
import { Printer } from 'lucide-react';
import { useBodyEntries, useCheckIns, useDoses, useFamily, useMeds, useSettings } from '../../app/data';
import { medIsFor, personOf } from '../../db/repos/people';
import { printPage } from '../../app/print';
import { useNow } from '../../app/useNow';
import { lotStats, stepReport } from '../../logic/protocol';
import { fmtAmount, fmtSchedule } from '../../logic/format';
import { kgTo, lengthUnit, weightUnit } from '../../logic/units';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { Button } from '../../components/ui/Button';
import { APP_NAME } from '../../config';

const day = (ms: number) => format(ms, 'd MMM yyyy');
const signed = (s: string) => (s.startsWith('-') ? s : `+${s}`);

/** One page per peptide for a doctor: each dose step with how long it lasted, weight and waist per week, appetite and
 *  side effects, then results by batch. What was recorded, side by side; it doesn't show cause. */
export function ProtocolReport() {
  const meds = useMeds();
  const doses = useDoses();
  const body = useBodyEntries();
  const checkIns = useCheckIns();
  const settings = useSettings();
  const fam = useFamily();
  const now = useNow(60_000);
  if (!meds || !doses || !body || !checkIns || !settings || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const units = settings.units;
  const peptides = meds.filter((m) => m.peptide && medIsFor(m, fam.personId) && doses.some((d) => d.medicationId === m.id && !d.deletedAt));
  const myBody = body.filter((b) => personOf(b) === fam.personId);
  const myCheckIns = checkIns.filter((c) => personOf(c) === fam.personId);
  const perWeek = (v: number | undefined, kind: 'w' | 'l') => v === undefined ? '–'
    : kind === 'w' ? `${signed(String(kgTo(v, units)))} ${weightUnit(units)}` : `${signed(String(units === 'imperial' ? Math.round(v / 2.54 * 10) / 10 : v))} ${lengthUnit(units)}`;

  return (
    <div className="space-y-4 report">
      <div className="no-print"><PersonSwitcher /></div>
      <div className="no-print space-y-2">
        <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={() => printPage(`${APP_NAME} protocol report`)} disabled={!peptides.length}>
          <Printer size={20} aria-hidden="true" /> Print / Save as PDF
        </Button>
        <p className="text-sm text-muted">One page per peptide. In the print dialog, choose “Save as PDF” to email it or bring it to an appointment.</p>
      </div>
      {peptides.length === 0 && <p className="border-t border-border pt-5">No peptide doses logged yet{fam.many ? ` for ${fam.person}` : ''}.</p>}
      {peptides.map((m) => {
        const steps = stepReport(m, doses, myBody, myCheckIns, now);
        const lots = lotStats(m, doses, myBody, myCheckIns, now);
        return (
          <article key={m.id} className="border-t border-border pt-5 report-block space-y-4" style={{ breakAfter: 'page' }}>
            <header>
              <h2 className="text-2xl font-medium">{m.name}{fam.many ? ` · ${fam.person}` : ''}</h2>
              <p className="text-muted tnum">{fmtSchedule(m.schedule, m.unit)} · now {fmtAmount(m.defaultAmount, m.unit)} · report made {day(now)}</p>
            </header>
            <section>
              <h3 className="text-sm font-medium text-muted mb-2">Dose steps</h3>
              <div className="table-scroll">
                <table className="w-full text-sm tnum">
                  <thead><tr className="text-left">{['Dose', 'From', 'Weeks', 'Doses', 'Weight/week', 'Waist/week', 'Appetite (1–5)', 'Side effects (share of check-ins)'].map((h) => <th key={h} className="py-1.5 pr-3 border-b border-border font-medium">{h}</th>)}</tr></thead>
                  <tbody>
                    {steps.map((st) => (
                      <tr key={st.from}>
                        <td className="py-1.5 pr-3 border-b border-border font-medium">{fmtAmount(st.dose, m.unit)}</td>
                        <td className="py-1.5 pr-3 border-b border-border">{day(st.from)}</td>
                        <td className="py-1.5 pr-3 border-b border-border">{st.weeks}</td>
                        <td className="py-1.5 pr-3 border-b border-border">{st.doses}</td>
                        <td className="py-1.5 pr-3 border-b border-border">{perWeek(st.weightPerWeek, 'w')}</td>
                        <td className="py-1.5 pr-3 border-b border-border">{perWeek(st.waistPerWeek, 'l')}</td>
                        <td className="py-1.5 pr-3 border-b border-border">{st.appetite ?? '–'}{st.checkIns ? ` (${st.checkIns} check-in${st.checkIns === 1 ? '' : 's'})` : ''}</td>
                        <td className="py-1.5 pr-3 border-b border-border">{st.sideEffects.map((x) => `${x.chip} ${x.pct}%`).join(', ') || '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
            {lots.length > 0 && (
              <section>
                <h3 className="text-sm font-medium text-muted mb-2">Batches</h3>
                <div className="table-scroll">
                  <table className="w-full text-sm tnum">
                    <thead><tr className="text-left">{['Lot', 'Supplier', 'In use', 'Doses', 'Weight/week', 'Appetite', 'Noticed', 'Flag'].map((h) => <th key={h} className="py-1.5 pr-3 border-b border-border font-medium">{h}</th>)}</tr></thead>
                    <tbody>
                      {lots.map((b) => (
                        <tr key={b.lot}>
                          <td className="py-1.5 pr-3 border-b border-border font-medium">{b.lot}</td>
                          <td className="py-1.5 pr-3 border-b border-border">{b.supplier ?? '–'}</td>
                          <td className="py-1.5 pr-3 border-b border-border">{format(b.from, 'd MMM')} – {format(b.to, 'd MMM')}</td>
                          <td className="py-1.5 pr-3 border-b border-border">{b.doses}</td>
                          <td className="py-1.5 pr-3 border-b border-border">{perWeek(b.perWeek, 'w')}</td>
                          <td className="py-1.5 pr-3 border-b border-border">{b.appetite ?? '–'}</td>
                          <td className="py-1.5 pr-3 border-b border-border">{b.noticed.map((x) => `${x.chip} (${x.n})`).join(', ') || '–'}</td>
                          <td className="py-1.5 pr-3 border-b border-border">{b.flag ? (b.flag.note || 'Flagged') : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
            <p className="text-xs text-muted">What was recorded on each step and batch, side by side. It doesn't show cause. Doses and plans are the person's own, from their prescriber.</p>
          </article>
        );
      })}
    </div>
  );
}
