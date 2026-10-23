import { lazy, Suspense, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import type { Dose, Medication } from '../../db/schema';
import { useBodyEntries, useCheckIns, useDoses, useFamily, useMeds, useScheduleSettings, useSupplies } from '../../app/data';
import { medIsFor, personOf } from '../../db/repos/people';
import { useNow } from '../../app/useNow';
import { go } from '../../app/router';
import { cycleInfo, getDayBounds, getExpectedAmount, getNextDue, getStatus, type ScheduleSettings } from '../../logic/schedule';
import { nextPlannedChange } from '../../logic/plans';
import { dayKey } from '../../logic/stats';
import { fmtAmount, fmtSchedule, fmtWhen } from '../../logic/format';
import { guideText, isPen, stockVials, SUPPLY_LABELS, vialStatus } from '../../logic/peptide';
import { DEFAULT_LEAD_DAYS, lotStats, stockPlan, supplyPlans } from '../../logic/protocol';
import { appetiteCurve, bestShotDay, changeFlags, lateShots, sideEffectForecast, vialRest, weekFindings, weekRecords, weightPath, basisText } from '../../logic/predict';
import type { Units } from '../../db/repos/settings';
import { HAS_BODY } from '../../edition';
import { kgTo } from '../../logic/units';
import { AppetiteStrip, Basis, ComingWeek, FlagList, LateShotsSheet, NeedsSheet, PatternsSheet, ShotDaySheet, vialRestText } from './Predictions';
import { shownColour, shownName } from '../../logic/privacy';
import { MedBadge } from '../../components/MedBadge';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { Button } from '../../components/ui/Button';
import { WeekStrip } from './WeekStrip';
import { LeadTimeSheet, LotSheet } from './ProtocolSheets';

const LevelProjection = lazy(() => import('../../components/charts/LevelProjection'));
const WeightPathChart = lazy(() => import('../../components/charts/WeightPath'));
const DAY = 86_400_000;
const day = (ms: number) => format(ms, 'EEE d MMM');
const ymdDay = (ymd: string) => format(new Date(`${ymd}T12:00`), 'EEE d MMM');

/** The Protocol tab (peptide tools): each peptide's plan, vial, stock and batches on one screen, then supplies. */
export function Protocol() {
  const meds = useMeds();
  const doses = useDoses();
  const body = useBodyEntries();
  const checkIns = useCheckIns();
  const supplies = useSupplies();
  const ss = useScheduleSettings();
  const fam = useFamily();
  const now = useNow(60_000);
  const [needs, setNeeds] = useState(false);
  if (!meds || !doses || !body || !checkIns || !supplies || !ss || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const goal = fam.people.find((p) => p.id === fam.personId)?.goals?.find((g) => g.metric === 'weightKg')?.target;
  const peptides = meds.filter((m) => m.peptide && !m.archived && medIsFor(m, fam.personId));
  const mine = <T extends { personId?: string }>(r: T) => personOf(r) === fam.personId;
  const allPeptides = meds.filter((m) => m.peptide && !m.archived);
  const lead = Math.min(...allPeptides.map((m) => m.peptide?.leadTimeDays ?? DEFAULT_LEAD_DAYS), DEFAULT_LEAD_DAYS);
  const sup = supplyPlans(supplies, allPeptides, doses, now, s, lead);

  return (
    <div className="space-y-2">
      <PersonSwitcher />
      {peptides.length === 0 ? (
        <section className="border-t border-border pt-5 space-y-3">
          <p>No peptides yet{fam.many ? ` for ${fam.person}` : ''}. Add one with the injection form and it shows here: its plan, vial, stock and batches.</p>
          <Button onClick={() => go('/meds/new')}>Add a peptide</Button>
        </section>
      ) : peptides.map((m) => (
        <PeptideSection key={m.id} med={m} doses={doses} s={s} now={now} body={body.filter(mine)} checkIns={checkIns.filter(mine)}
          units={settings.units} busy={settings.busyDays} goal={goal} />
      ))}

      {sup.length > 0 && (
        <section aria-labelledby="sup-h" className="border-t border-border pt-5">
          <div className="flex items-baseline justify-between">
            <h2 id="sup-h" className="text-sm font-medium text-muted">Supplies</h2>
            <span className="flex gap-4">
              <button type="button" onClick={() => setNeeds(true)} className="text-sm font-medium underline underline-offset-4">Enough until…</button>
              <a href="#/supplies" className="text-sm font-medium underline underline-offset-4">Update counts</a>
            </span>
          </div>
          <dl className="mt-1">
            {sup.map(({ supply, count, runOutAt, orderBy }) => {
              const label = SUPPLY_LABELS[supply.kind];
              const sharps = supply.kind === 'sharps';
              const soon = orderBy !== null && orderBy - now < 3 * DAY;
              return (
                <Row key={supply.id} label={label.name}>
                  <span className="tnum">{sharps ? `${count} of ${supply.capacity ?? '?'} in it` : `${count}${label.unit ? ` ${label.unit}` : ''} left`}</span>
                  {runOutAt !== null && (
                    <span className={`block text-sm tnum ${soon ? 'text-caution font-medium' : 'text-muted'}`}>
                      {sharps ? `Full around ${day(runOutAt)}` : `Runs out ${day(runOutAt)} · order by ${day(orderBy!)}`}
                    </span>
                  )}
                </Row>
              );
            })}
          </dl>
        </section>
      )}

      {sup.length === 0 && peptides.length > 0 && (
        <button type="button" onClick={() => setNeeds(true)} className="w-full border-t border-border flex items-center justify-between min-h-[64px] text-[17px] font-medium text-left">
          Enough until…<span className="text-sm font-normal text-muted">Stock for a trip or a date</span>
        </button>
      )}
      {needs && <NeedsSheet meds={meds.filter((m) => medIsFor(m, fam.personId))} supplies={supplies} doses={doses} s={s} now={now} onClose={() => setNeeds(false)} />}
      {peptides.length > 0 && (
        <a href="#/protocol/report" className="border-t border-border flex items-center justify-between min-h-[64px] text-[17px] font-medium">
          Protocol report<span className="text-sm font-normal text-muted">Each dose step, for your doctor</span>
        </a>
      )}
      <p className="text-sm text-muted pt-2">These are your own numbers and plan. Check doses with your prescriber or pharmacist.</p>
    </div>
  );
}

/** A label and its value. Inside a <dl> as a <div> group; a tappable row keeps the button around the text only. */
function Row({ label, children, onClick }: { label: string; children: ReactNode; onClick?: () => void }) {
  return onClick ? (
    <div className="border-t border-border">
      <dt className="sr-only">{label}</dt>
      <dd><button onClick={onClick} className="w-full flex justify-between gap-4 py-3 text-left"><span className="text-muted shrink-0" aria-hidden="true">{label}</span><span className="text-right min-w-0">{children}</span></button></dd>
    </div>
  ) : (
    <div className="flex justify-between gap-4 py-3 border-t border-border">
      <dt className="text-muted shrink-0">{label}</dt>
      <dd className="text-right min-w-0">{children}</dd>
    </div>
  );
}

function PeptideSection({ med, doses, s, now, body, checkIns, units, busy, goal }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; body: Parameters<typeof lotStats>[2]; checkIns: Parameters<typeof lotStats>[3];
  units: Units; busy: number[]; goal?: number;
}) {
  const [lots, setLots] = useState(false);
  const [leadSheet, setLeadSheet] = useState(false);
  const [sheet, setSheet] = useState<'late' | 'day' | 'patterns' | null>(null);
  const pen = isPen(med);
  const status = getStatus(med, doses, now, s);
  const next = getNextDue(med, doses, now, s);
  const nextAmount = next !== null ? getExpectedAmount(med, doses, next, s) : med.defaultAmount;
  const guide = guideText(med, nextAmount);
  const change = nextPlannedChange(med, dayKey(now, s));
  const cyc = med.schedule.cycle ? cycleInfo(med.schedule.cycle, getDayBounds(now, s.dayStartsAt, s.tz).start, s) : undefined;
  const vial = vialStatus(med, doses, now);
  const stock = stockVials(med).length;
  const sp = stockPlan(med, doses, now, s);
  const batches = lotStats(med, doses, body, checkIns, now);
  const orderSoon = sp.orderBy !== null && sp.orderBy - now < 3 * DAY;
  // Predictions, from this person's own records.
  const flags = changeFlags(med, doses, checkIns, HAS_BODY ? body : [], now);
  const fc = sideEffectForecast(med, doses, checkIns, now, s);
  const curve = appetiteCurve(med, doses, checkIns, now);
  const rest = vialRest(med, doses, now, s);
  const restText = rest ? vialRestText(rest, med.unit, pen) : '';
  const path = HAS_BODY ? weightPath(med, doses, body, now, 12, goal) : null;
  const late = lateShots(med, doses, checkIns, now, s);
  const lateCount = late?.events.length ?? 0;
  const weekly = med.schedule.type === 'fixed' && med.schedule.days?.length === 1;
  const shotDay = weekly ? bestShotDay(med, doses, checkIns, busy) : null;
  const recs = weekRecords(med, doses, checkIns, now, s);
  const findings = weekFindings(recs);
  const weeksWithCheckIns = recs.filter((w) => w.checkIns >= 2).length;

  return (
    <section aria-label={shownName(med)} className="border-t border-border pt-5 pb-3">
      <a href={`#/meds/${med.id}`} className="flex items-center gap-2.5">
        <MedBadge color={shownColour(med)} icon={med.icon} size={34} />
        <h2 className="text-[22px] leading-7 font-medium flex-1 min-w-0 truncate">{shownName(med)}</h2>
        <span className="text-[15px] tnum">{fmtAmount(med.defaultAmount, med.unit)}</span>
      </a>
      <p className="ml-5 text-[15px] text-muted">{fmtSchedule(med.schedule, med.unit)}</p>

      <div className="my-5"><WeekStrip med={med} doses={doses} s={s} now={now} label={false} /></div>
      <FlagList flags={flags} />

      <dl>
        <Row label="Next shot">
          <span className="tnum">{status === 'due' ? 'Now' : next !== null ? fmtWhen(next, now) : status === 'done-today' ? 'Done today' : 'Not planned'}</span>
          {nextAmount > 0 && <span className="block text-sm text-muted tnum">{fmtAmount(nextAmount, med.unit)}{guide ? ` · ${guide}` : ''}</span>}
        </Row>
        <Row label="Next change">
          {change
            ? <><span className="tnum">{ymdDay(change.from)}</span><span className="block text-sm text-muted tnum">{fmtAmount(med.defaultAmount, med.unit)} → {fmtAmount(change.defaultAmount, med.unit)}{change.note ? ` · ${change.note}` : ''}</span></>
            : <a href={`#/meds/${med.id}`} className="underline underline-offset-4">None planned</a>}
        </Row>
        {cyc && (
          <Row label="Cycle">
            <span className="tnum">{cyc.phase === 'before' ? `Starts ${ymdDay(cyc.nextChange)}` : cyc.phase === 'off' ? `Off, day ${cyc.day} of ${cyc.length}` : `On, day ${cyc.day} of ${cyc.length}`}</span>
            {cyc.phase !== 'before' && <span className="block text-sm text-muted">{cyc.phase === 'on' ? 'Break' : 'Back on'} from {ymdDay(cyc.nextChange)}</span>}
          </Row>
        )}
        <Row label={pen ? 'Pen' : 'Vial'} onClick={() => go(`/meds/${med.id}`)}>
          {vial ? (
            <>
              <span className="tnum">{vial.dosesLeft} dose{vial.dosesLeft === 1 ? '' : 's'} left</span>
              <span className={`block text-sm tnum ${vial.expired || vial.dosesLeft <= 1 ? 'text-caution font-medium' : 'text-muted'}`}>
                {pen ? 'Started' : 'Mixed'} {day(vial.startedAt)}{vial.useBy ? ` · ${vial.expired ? 'past use-by' : 'use by'} ${day(vial.useBy)}` : ''}
              </span>
              {restText && <span className={`block text-sm tnum ${rest?.ends === 'use-by' && rest.leftover > 0 ? 'text-caution' : 'text-muted'}`}>{restText}</span>}
            </>
          ) : <span className="underline underline-offset-4">{pen ? 'Start a pen' : 'Mix a vial'}</span>}
        </Row>
        <Row label="Stock" onClick={() => setLeadSheet(true)}>
          <span className="tnum">{stock} {pen ? 'pen' : 'vial'}{stock === 1 ? '' : 's'} unopened</span>
          {sp.forecast?.runOutAt != null ? (
            <span className={`block text-sm tnum ${orderSoon ? 'text-caution font-medium' : 'text-muted'}`}>
              Runs out {day(sp.forecast.runOutAt)} · order by {day(sp.orderBy!)}
            </span>
          ) : <span className="block text-sm text-muted">{sp.forecast ? 'Enough for over a year' : 'Add a stock count to forecast'}</span>}
          <span className="block text-xs text-muted">Delivery takes {sp.leadDays} day{sp.leadDays === 1 ? '' : 's'}</span>
        </Row>
        {batches.length > 0 && (
          <Row label="Batches" onClick={() => setLots(true)}>
            <span className="tnum">{batches.length} used</span>
            {batches.some((b) => b.flag) && <span className="block text-sm text-caution font-medium">{batches.filter((b) => b.flag).length} flagged</span>}
          </Row>
        )}
        {med.schedule.type === 'fixed' && (
          <Row label="Late or missed" onClick={() => setSheet('late')}>
            <span className="tnum">{lateCount ? `${lateCount} in 12 weeks` : 'None in 12 weeks'}</span>
          </Row>
        )}
        {weekly && (
          <Row label="Best shot day" onClick={() => setSheet('day')}>
            <span>{!busy.length ? 'Mark your busy days' : shotDay ? shotDay.options.filter((o) => o.score === shotDay.options[0].score).map((o) => DAY_NAMES[o.weekday]).slice(0, 2).join(' or ') : 'Needs more check-ins'}</span>
          </Row>
        )}
        <Row label="Patterns" onClick={() => setSheet('patterns')}>
          <span className="tnum">{findings.length ? `${findings.length} found` : weeksWithCheckIns < 4 ? 'Needs more weeks' : 'No clear differences'}</span>
          <span className="block text-xs text-muted">{weeksWithCheckIns} week{weeksWithCheckIns === 1 ? '' : 's'} with check-ins</span>
        </Row>
      </dl>

      {(fc || curve) && (
        <div className="mt-5 space-y-5">
          {fc && <ComingWeek fc={fc} />}
          {curve && <AppetiteStrip c={curve} />}
        </div>
      )}

      {HAS_BODY && (
        <div className="mt-5">
          <p className="text-sm font-medium text-muted mb-2">Weight path</p>
          {path ? (
            <>
              <Suspense fallback={<div className="h-[170px]" />}><WeightPathChart path={path} body={body} units={units} now={now} /></Suspense>
              <p className="text-[15px] mt-2 tnum">{pathSummary(path, units, med.unit)}</p>
              <Basis text={`${basisText(path.basis)}. If the trend continues${path.segments.length > 1 ? ', following your planned changes' : ''}; not a promise.`} />
            </>
          ) : <p className="text-sm text-muted">Log your weight 5 times over a week or more to see where it's heading through your plan.</p>}
        </div>
      )}

      <div className="mt-4">
        {med.peptide?.halfLifeHours
          ? <Suspense fallback={<div className="h-[150px]" />}><LevelProjection med={med} doses={doses.filter((d) => d.medicationId === med.id)} s={s} now={now} /></Suspense>
          : <p className="text-sm text-muted">Add a half-life on <a href={`#/meds/${med.id}`} className="underline underline-offset-4">its page</a> to see the estimated level through your plan.</p>}
      </div>

      {sheet === 'late' && late && <LateShotsSheet med={med} report={late} onClose={() => setSheet(null)} />}
      {sheet === 'late' && !late && <LateShotsSheet med={med} report={{ events: [], basis: { weeks: 12 } }} onClose={() => setSheet(null)} />}
      {sheet === 'day' && <ShotDaySheet result={shotDay} busy={busy} onClose={() => setSheet(null)} />}
      {sheet === 'patterns' && <PatternsSheet findings={findings} weeks={weeksWithCheckIns} onClose={() => setSheet(null)} />}
      {lots && <LotSheet med={med} batches={batches} onClose={() => setLots(false)} />}
      {leadSheet && <LeadTimeSheet med={med} onClose={() => setLeadSheet(false)} />}
    </section>
  );
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pathSummary(p: NonNullable<ReturnType<typeof weightPath>>, units: Units, unit: string): string {
  const u = units === 'imperial' ? 'lb' : 'kg';
  const k = (kg: number) => kgTo(kg, units);
  const end = p.points[p.points.length - 1];
  const weeks = p.points.length - 1;
  let out = `About ${k(end.v)} ${u} in ${weeks} weeks (likely ${k(end.low)}–${k(end.high)}), at ${k(p.perWeek)} ${u} a week now.`;
  const later = p.segments.slice(1).filter((x) => x.basis === 'this-dose');
  if (later.length) out += ` From ${format(later[0].from, 'd MMM')} uses your own rate on ${fmtAmount(later[0].amount, unit)}.`;
  if (p.goal?.eta) out += ` Reaches your goal around ${format(p.goal.eta, 'd MMM')}${p.goal.early && p.goal.late ? ` (likely ${format(p.goal.early, 'd MMM')}–${format(p.goal.late, 'd MMM')})` : ''}.`;
  else if (p.goal) out += ' Your goal is beyond these weeks.';
  return out;
}
