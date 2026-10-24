import { costSummary, money } from '../../logic/cost';
import { planLine, stepStatus } from '../../logic/dosePlan';
import { stepSummary } from '../../components/DosePlan';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import type { Dose, Medication } from '../../db/schema';
import { useBodyEntries, useCheckIns, useDoses, useFamily, useMeds, useScheduleSettings, useSupplies } from '../../app/data';
import { medIsFor, personOf } from '../../db/repos/people';
import { useNow } from '../../app/useNow';
import { go } from '../../app/router';
import { getExpectedAmount, getNextDue, getStatus, type ScheduleSettings } from '../../logic/schedule';
import { nextPlannedChange } from '../../logic/plans';
import { dayKey } from '../../logic/stats';
import { fmtAmount, fmtSchedule, fmtWhen } from '../../logic/format';
import { guideText, isPen, stockVials, SUPPLY_LABELS, vialStatus } from '../../logic/peptide';
import { DEFAULT_LEAD_DAYS, lotStats, stockPlan, supplyPlans } from '../../logic/protocol';
import { appetiteCurve, bestShotDay, changeFlags, lateShots, sideEffectForecast, vialRest, weekFindings, weekRecords, weightPath } from '../../logic/predict';
import type { Units } from '../../db/repos/settings';
import { HAS_BODY } from '../../edition';
import { kgTo } from '../../logic/units';
import { AppetiteStrip, ComingWeek, FlagList, LateShotsSheet, NeedsSheet, PatternsSheet, ShotDaySheet, vialRestText, WeeklySummaryBlock } from './Predictions';
import { weeklySummary } from '../../logic/predict';
import { shownColour, shownName } from '../../logic/privacy';
import { MedBadge } from '../../components/MedBadge';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { Button } from '../../components/ui/Button';
import { WeekStrip } from './WeekStrip';
import { Tile } from '../../components/ui/Visual';
import { StepUpCard } from '../../components/Insights';
import { Calculator, CalendarRange, ChevronRight, FileText, Package, TrendingDown } from 'lucide-react';
import { LeadTimeSheet, LotSheet } from './ProtocolSheets';

const LevelProjection = lazy(() => import('../../components/charts/LevelProjection'));
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
          <h2 id="sup-h" className="text-sm font-medium text-muted">Supplies</h2>
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

      {needs && <NeedsSheet meds={meds.filter((m) => medIsFor(m, fam.personId))} supplies={supplies} doses={doses} s={s} now={now} onClose={() => setNeeds(false)} />}
      <div className="border-t border-border pt-4 grid grid-cols-4 gap-2" role="group" aria-label="Tools">
        <Tile Icon={Calculator} label="Calculator" href="#/calc" />
        <Tile Icon={Package} label="Supplies" href="#/supplies" />
        {peptides.length > 0 && <Tile Icon={CalendarRange} label="Enough until" name="Enough until: stock for a trip or a date" onClick={() => setNeeds(true)} />}
        {peptides.length > 0 && <Tile Icon={FileText} label="Report" name="Protocol report for your doctor" href="#/protocol/report" />}
      </div>
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
  const plan = planLine(med, now, s);
  const step = stepStatus(med, doses.filter((d) => d.medicationId === med.id), checkIns, HAS_BODY ? body : [], now, s);
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
      <div className="mb-5"><WeeklySummaryBlock w={weeklySummary(med, doses, checkIns, HAS_BODY ? body : [], now, s)} med={med} units={units} /></div>
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
        {plan && (
          <Row label="Plan" onClick={() => go(`/meds/${med.id}`)}>
            <span className="tnum">{plan.split(' · ')[0]}</span>
            {plan.includes(' · ') && <span className="block text-sm text-muted tnum">{plan.split(' · ').slice(1).join(' · ')}</span>}
          </Row>
        )}
        {step && (
          <Row label="Step plan" onClick={() => go(`/meds/${med.id}`)}>
            <span className="tnum">{step.ready ? `Ready: ${fmtAmount(step.next, med.unit)}` : step.atLimit ? 'At your limit' : `Next ${fmtAmount(step.next, med.unit)}`}</span>
            <span className="block text-sm text-muted">{stepSummary(med, step, now)}</span>
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
        {(() => {
          const c = costSummary(med, doses, now, s);
          if (!c) return (
            <Row label="Cost" onClick={() => go(`/meds/${med.id}`)}><span className="text-muted underline underline-offset-4">Add a price</span></Row>
          );
          return (
            <Row label="Cost" onClick={() => go(`/meds/${med.id}`)}>
              <span className="tnum">{c.perWeek !== undefined ? `${money(c.perWeek)} a week` : c.perUnit !== undefined ? `${money(c.perUnit)} per ${med.unit}` : `${money(c.spent)} so far`}</span>
              <span className="block text-sm text-muted tnum">
                {[c.perMonth !== undefined ? `${money(c.perMonth)} a month` : '', c.perUnit !== undefined ? `${money(c.perUnit)} per ${med.unit}` : '', c.next12Weeks !== undefined ? `next 12 weeks ${money(c.next12Weeks)} with your plan` : ''].filter(Boolean).join(' · ')}
              </span>
              {c.cheapest && <span className="block text-xs text-muted tnum">Cheapest per {med.unit}: {c.cheapest[0].supplier} ({money(c.cheapest[0].perUnit)}) vs {c.cheapest[c.cheapest.length - 1].supplier} ({money(c.cheapest[c.cheapest.length - 1].perUnit)})</span>}
            </Row>
          );
        })()}
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

      <StepUpCard med={med} doses={doses} checkIns={checkIns} body={HAS_BODY ? body : []} now={now} s={s} />

      {(fc || curve) && (
        <div className="mt-5 space-y-5">
          {fc && <ComingWeek fc={fc} />}
          {curve && <AppetiteStrip c={curve} />}
        </div>
      )}

      {HAS_BODY && (
        <div className="mt-5">
          {path ? (
            <a href="#/progress/body"
              className="flex items-center gap-3 rounded-card bg-surface-2 p-3">
              <TrendingDown aria-hidden="true" className="shrink-0" />
              <span className="flex-1 min-w-0">
                <span className="block text-sm text-muted">Weight in {path.points.length - 1} weeks</span>
                <span className="block tnum"><span className="text-[22px] font-semibold">{kgTo(path.points[path.points.length - 1].v, units)}</span> <span className="text-sm text-muted">{units === 'imperial' ? 'lb' : 'kg'} · likely {kgTo(path.points[path.points.length - 1].low, units)}–{kgTo(path.points[path.points.length - 1].high, units)}</span></span>
              </span>
              <span className="text-sm font-medium flex items-center gap-1">Chart <ChevronRight size={16} aria-hidden="true" /></span>
            </a>
          ) : <p className="text-sm text-muted">Log weight 5 times to see where it's heading.</p>}
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

