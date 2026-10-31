import { costSummary, money } from '../../logic/cost';
import { planLine } from '../../logic/dosePlan';
import { DosePlanCard } from '../../components/DosePlan';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import type { Dose, Medication, Person } from '../../db/schema';
import { useBodyEntries, useCheckIns, useDoses, useFamily, useMeds, useScheduleSettings, useSupplies } from '../../app/data';
import { medIsFor, personOf } from '../../db/repos/people';
import { useNow } from '../../app/useNow';
import { go } from '../../app/router';
import { getExpectedAmount, getNextDue, getStatus, type ScheduleSettings } from '../../logic/schedule';
import { fmtAmount, fmtTime, fmtWhen } from '../../logic/format';
import { guideText, isPen, stockVials, SUPPLY_LABELS, vialStatus } from '../../logic/peptide';
import { DEFAULT_LEAD_DAYS, lotStats, stockPlan, supplyPlans } from '../../logic/protocol';
import { appetiteCurve, bestShotDay, changeFlags, lateShots, sideEffectForecast, vialRest, weekFindings, weekRecords, weightPath } from '../../logic/predict';
import type { Units } from '../../db/repos/settings';
import { HAS_BODY } from '../../edition';
import { kgTo } from '../../logic/units';
import { AppetiteStrip, ComingWeek, FlagList, LateShotsSheet, NeedsSheet, PatternsSheet, ShotDaySheet, vialRestText, WeeklySummaryBlock } from './Predictions';
import { weeklySummary } from '../../logic/predict';
import { shownColour, shownMedName, shownName } from '../../logic/privacy';
import { MedBadge } from '../../components/MedBadge';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { Button } from '../../components/ui/Button';
import { WeekStrip } from './WeekStrip';
import { Tile } from '../../components/ui/Visual';
import { AlertTriangle, BookOpen, Calculator, CalendarRange, ChevronRight, FileText, Package, TrendingDown } from 'lucide-react';
import { guideFor, lowestPlan, splitView } from '../../logic/peptideGuide';
import { dosesPerWeek } from '../../logic/dosePlan';
import { SwingBars } from '../../components/SwingBars';
import { CourseBar } from '../../components/CourseBar';
import { WatchPeptide } from '../../components/WatchPeptide';
import { ShotBodySection } from '../../components/Biohack';
import { costPerKg, missedShot } from '../../logic/peptideSmart';
import { ChipPicker } from '../../components/ui/Field';
import { Sheet } from '../../components/ui/Sheet';
import { LogDoseFlow } from '../../components/LogDoseFlow';
import { StartVialSheet } from '../Meds/VialCard';

import { useToast } from '../../app/toast';
import { saveStepPlan, setHalfLife } from '../../db/repos/meds';
import { removeDose } from '../../db/repos/doses';
import { LeadTimeSheet, LotSheet } from './ProtocolSheets';

const LevelProjection = lazy(() => import('../../components/charts/LevelProjection'));
const DAY = 86_400_000;
const day = (ms: number) => format(ms, 'EEE d MMM');

/** The Protocol tab (peptide tools), for one peptide at a time (chips pick which): the next shot and what to draw, how
 *  it's going, the plan drawn as steps, then stock and supplies. */
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
  const [asked, setAsked] = useState<string | null>(() => { try { return localStorage.getItem('protocolMed'); } catch { return null; } });
  if (!meds || !doses || !body || !checkIns || !supplies || !ss || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const goal = fam.people.find((p) => p.id === fam.personId)?.goals?.find((g) => g.metric === 'weightKg')?.target;
  const peptides = meds.filter((m) => m.peptide && !m.archived && medIsFor(m, fam.personId));
  const mine = <T extends { personId?: string }>(r: T) => personOf(r) === fam.personId;
  const allPeptides = meds.filter((m) => m.peptide && !m.archived);
  const lead = Math.min(...allPeptides.map((m) => m.peptide?.leadTimeDays ?? DEFAULT_LEAD_DAYS), DEFAULT_LEAD_DAYS);
  const sup = supplyPlans(supplies, allPeptides, doses, now, s, lead);
  const med = peptides.find((m) => m.id === asked) ?? peptides[0];
  const pick = (id: string) => { setAsked(id); try { localStorage.setItem('protocolMed', id); } catch { /* per-device preference only */ } };

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      {!med ? (
        <section className="border-t border-border pt-5 space-y-3">
          <p>No peptides yet{fam.many ? ` for ${fam.person}` : ''}. Add one with the injection form and it shows here: the next shot, how it's going, its plan and stock.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={() => go('/guide')}>Pick from the guide</Button>
            <Button variant="secondary" onClick={() => go('/meds/new')}>Add your own</Button>
          </div>
        </section>
      ) : (
        <>
          {peptides.length > 1 && <ChipPicker label="Peptide" value={med.id} onChange={pick} options={peptides.map((m) => ({ value: m.id, label: shownName(m) }))} />}
          <PeptideSection key={med.id} med={med} doses={doses} s={s} now={now} body={body.filter(mine)} checkIns={checkIns.filter(mine)}
            units={settings.units} busy={settings.busyDays} goal={goal} people={fam.people} personId={fam.personId} />
        </>
      )}

      <section aria-labelledby="stock-h" className="border-t border-border pt-5">
        <h2 id="stock-h" className="text-sm font-medium text-muted">Stock</h2>
        <dl className="mt-1">
          {med && <MedStock med={med} doses={doses} s={s} now={now} body={body.filter(mine)} checkIns={checkIns.filter(mine)} />}
          {sup.map(({ supply, count, runOutAt, orderBy }) => {
            const label = SUPPLY_LABELS[supply.kind];
            const sharps = supply.kind === 'sharps';
            const soon = orderBy !== null && orderBy - now < 3 * DAY;
            return (
              <Row key={supply.id} label={label.name} onClick={() => go('/supplies')}>
                <span className="tnum">{sharps ? `${count} of ${supply.capacity ?? '?'} in it` : `${count}${label.unit ? ` ${label.unit}` : ''} left`}</span>
                {runOutAt !== null && (
                  <span className={`block text-sm tnum ${soon ? 'text-caution font-medium' : 'text-muted'}`}>
                    {sharps ? `Full around ${day(runOutAt)}` : `Order by ${day(orderBy!)}`}
                  </span>
                )}
              </Row>
            );
          })}
        </dl>
        <div className="pt-4 grid grid-cols-3 gap-2" role="group" aria-label="Tools">
          <Tile Icon={Calculator} label="Calculator" href="#/calc" />
          <Tile Icon={Package} label="Supplies" href="#/supplies" />
          <Tile Icon={BookOpen} label="Guide" name="Peptide guide" href="#/guide" />
          {peptides.length > 0 && <Tile Icon={CalendarRange} label="Enough until" name="Enough until: stock for a trip or a date" onClick={() => setNeeds(true)} />}
          {peptides.length > 0 && <Tile Icon={FileText} label="Report" name="Protocol report for your doctor" href="#/protocol/report" />}
        </div>
      </section>
      {needs && <NeedsSheet meds={meds.filter((m) => medIsFor(m, fam.personId))} supplies={supplies} doses={doses} s={s} now={now} onClose={() => setNeeds(false)} />}
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

function PeptideSection({ med, doses, s, now, body, checkIns, units, busy, goal, people, personId }: {
  med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; body: Parameters<typeof lotStats>[2]; checkIns: Parameters<typeof lotStats>[3];
  units: Units; busy: number[]; goal?: number; people: Person[]; personId: string;
}) {
  const [sheet, setSheet] = useState<'late' | 'day' | 'patterns' | 'start' | 'log' | null>(null);
  const toast = useToast();
  const pen = isPen(med);
  const status = getStatus(med, doses, now, s);
  const next = getNextDue(med, doses, now, s);
  const nextAmount = next !== null ? getExpectedAmount(med, doses, next, s) : med.defaultAmount;
  const guide = guideText(med, nextAmount);
  const plan = planLine(med, now, s);
  const missed = missedShot(med, doses, now, s);
  const vial = vialStatus(med, doses, now);
  const rest = vialRest(med, doses, now, s);
  const restText = rest ? vialRestText(rest, med.unit, pen) : '';
  // What the vial or pen means for the next shot: the one thing to do, if anything.
  const word = pen ? 'pen' : 'vial';
  const problem = !vial ? `No ${word} in use`
    : vial.expired ? `This ${word} is past its use-by`
    : vial.left + 1e-9 < nextAmount ? `Not enough left in this ${word} for the next shot`
    : vial.useBy !== undefined && next !== null && next > vial.useBy ? `This ${word} passes its use-by before the next shot` : null;
  // Predictions and look-backs, from this person's own records.
  const flags = changeFlags(med, doses, checkIns, HAS_BODY ? body : [], now);
  const fc = sideEffectForecast(med, doses, checkIns, now, s);
  const curve = appetiteCurve(med, doses, checkIns, now);
  const path = HAS_BODY ? weightPath(med, doses, body, now, 12, goal) : null;
  const late = lateShots(med, doses, checkIns, now, s);
  const lateCount = late?.events.length ?? 0;
  const weekly = med.schedule.type === 'fixed' && med.schedule.days?.length === 1;
  const shotDay = weekly ? bestShotDay(med, doses, checkIns, busy) : null;
  const recs = weekRecords(med, doses, checkIns, now, s);
  const findings = weekFindings(recs);
  const guideEntry = guideFor(med.name);
  const weeksWithCheckIns = recs.filter((w) => w.checkIns >= 2).length;
  const when = status === 'due' ? 'Due now' : next !== null ? fmtWhen(next, now) : status === 'done-today' ? 'Done today' : 'Not planned';
  const onLogged = (d: Dose) => {
    setSheet(null);
    toast(d.skipped ? 'Marked as skipped' : `Logged ${fmtAmount(d.amount, med.unit)} at ${fmtTime(Date.parse(d.takenAt))}`, { onAction: () => removeDose(d.id) });
  };

  return (
    <>
      {/* 1. The next shot: when, how much, what to draw, and the vial or pen it comes from. */}
      <section aria-label={`${shownName(med)}: next shot`} className="rounded-card bg-surface-2 p-4 space-y-4">
        <a href={`#/meds/${med.id}`} className="flex items-center gap-2.5">
          <MedBadge color={shownColour(med)} icon={med.icon} size={30} />
          <span className="text-[17px] font-medium flex-1 min-w-0 truncate">{shownName(med)}</span>
          <ChevronRight size={18} className="text-muted" aria-hidden="true" />
        </a>
        <div>
          <p className="text-sm text-muted">Next shot</p>
          <p className="text-[28px] leading-8 font-semibold tnum">{when}</p>
          {nextAmount > 0 && <p className="text-[17px] tnum mt-1">{fmtAmount(nextAmount, med.unit)}{guide ? <> · <span className="font-semibold">{pen ? guide : `draw ${guide}`}</span></> : null}</p>}
          {plan && <p className="text-sm text-muted mt-1">{plan}</p>}
          {missed && <p className={`text-sm mt-2 rounded-btn p-2.5 ${missed.take ? 'bg-caution-soft' : 'bg-surface-2'}`}>{missed.text}</p>}
          <CourseBar med={med} now={now} s={s} />
        </div>
        <WeekStrip med={med} doses={doses} s={s} now={now} label={false} />
        <div className={`rounded-btn p-3 ${problem ? 'bg-caution-soft' : 'bg-surface'}`}>
          {problem ? <p className="font-medium flex items-center gap-2"><AlertTriangle size={18} aria-hidden="true" className="shrink-0" />{problem}</p> : (
            <p className="tnum"><span className="font-medium">{vial!.dosesLeft} dose{vial!.dosesLeft === 1 ? '' : 's'} left</span> in this {word}{vial!.useBy ? <span className="text-muted"> · use by {day(vial!.useBy)}</span> : null}</p>
          )}
          {vial && <p className="text-sm text-muted tnum">{pen ? 'Started' : 'Mixed'} {day(vial.startedAt)}{problem ? ` · ${vial.dosesLeft} dose${vial.dosesLeft === 1 ? '' : 's'} left` : ''}</p>}
          {/* With a problem shown, the vial's own "not enough for the next dose" would only say it again. */}
          {restText && !problem && <p className={`text-sm tnum ${rest?.ends === 'use-by' && rest.leftover > 0 ? 'text-caution' : 'text-muted'}`}>{restText}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {problem
            ? <><Button className="min-h-[52px]" onClick={() => setSheet('start')}>{pen ? 'Start a new pen' : 'Mix a new vial'}</Button><Button variant="secondary" className="min-h-[52px]" onClick={() => setSheet('log')}>Log shot</Button></>
            : <><Button className="min-h-[52px]" onClick={() => setSheet('log')}>Log shot</Button>{!pen ? <Button variant="secondary" className="min-h-[52px]" onClick={() => go('/calc')}>Calculator</Button> : <Button variant="secondary" className="min-h-[52px]" onClick={() => go(`/meds/${med.id}`)}>Pen details</Button>}</>}
        </div>
      </section>

      {/* 2. How it's going. */}
      <section aria-labelledby="going-h" className="border-t border-border pt-5 space-y-5">
        <h2 id="going-h" className="sr-only">How it's going</h2>
        <WeeklySummaryBlock w={weeklySummary(med, doses, checkIns, HAS_BODY ? body : [], now, s)} med={med} units={units} onProtocol />
        <FlagList flags={flags} />
        <WatchPeptide med={med} doses={doses.filter((d) => d.medicationId === med.id)} now={now} s={s} />
        <ShotBodySection med={med} />
        {fc && <ComingWeek fc={fc} />}
        {curve && <AppetiteStrip c={curve} />}
        {path && (
          <a href="#/progress/body" className="flex items-center gap-3 rounded-card bg-surface-2 p-3">
            <TrendingDown aria-hidden="true" className="shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-sm text-muted">Weight in {path.points.length - 1} weeks</span>
              <span className="block tnum"><span className="text-[22px] font-semibold">{kgTo(path.points[path.points.length - 1].v, units)}</span> <span className="text-sm text-muted">{units === 'imperial' ? 'lb' : 'kg'} · likely {kgTo(path.points[path.points.length - 1].low, units)}–{kgTo(path.points[path.points.length - 1].high, units)}</span></span>
            </span>
            <ChevronRight size={18} aria-hidden="true" className="text-muted" />
          </a>
        )}
        <dl>
          {med.schedule.type === 'fixed' && (
            <Row label="Late or missed" onClick={() => setSheet('late')}><span className="tnum">{lateCount ? `${lateCount} in 12 weeks` : 'None in 12 weeks'}</span></Row>
          )}
          {weekly && (
            <Row label="Best shot day" onClick={() => setSheet('day')}>
              <span>{!busy.length ? 'Mark your busy days' : shotDay ? shotDay.options.filter((o) => o.score === shotDay.options[0].score).map((o) => DAY_NAMES[o.weekday]).slice(0, 2).join(' or ') : 'Needs more check-ins'}</span>
            </Row>
          )}
          {/* Only with something to say: "no clear differences" is a row of nothing. */}
          {findings.length > 0 && (
            <Row label="Patterns" onClick={() => setSheet('patterns')}>
              <span className="tnum">{findings.length} found</span>
            </Row>
          )}
          {guideEntry && <Row label="Guide" onClick={() => go(`/guide/${guideEntry.id}`)}><span>Mixing, storage, side effects</span></Row>}
        </dl>
      </section>

      {/* 3. The dose plan: every way the dose changes, in one place (also the home for editing it), then the
          estimated level through it. */}
      {guideEntry?.lowest && !med.stepPlan && (() => {
        const lp = lowestPlan(guideEntry, dosesPerWeek(med, now, s));
        return lp && (
          <button type="button" className="w-full text-left rounded-card bg-surface-2 p-3 min-h-[56px]" onClick={async () => {
            await saveStepPlan(med.id, lp.plan, lp.criteria);
            toast(`Staying on ${fmtAmount(med.defaultAmount, med.unit)} while it works`, { onAction: () => saveStepPlan(med.id, undefined, med.stepUp) });
          }}>
            <span className="block font-medium">Stay on the lowest dose that works</span>
            <span className="block text-sm text-muted">Holds {fmtAmount(med.defaultAmount, med.unit)} while you’re losing, and asks about a step only once loss slows under 0.25 kg a week for 3 weeks.</span>
          </button>
        );
      })()}
      <DosePlanCard med={med} flat />
      <section aria-label="Estimated level" className="space-y-3">
        {med.peptide?.halfLifeHours
          ? <><Suspense fallback={<div className="h-[150px]" />}><LevelProjection med={med} doses={doses.filter((d) => d.medicationId === med.id)} s={s} now={now} /></Suspense>
            {(() => {
              const sv = med.schedule.type === 'fixed' && !med.schedule.everyNDays ? splitView(med.peptide.halfLifeHours, med.schedule.days, guideEntry?.tmaxHours) : null;
              if (!sv) return null;
              const better = sv.swing - sv.other.swing;
              return (
                <div>
                  <p className="text-sm leading-snug">{sv.perWeek === 1
                    ? (better > 0.1 ? `Your level drops about ${Math.round(sv.swing * 100)}% before each shot. Two half shots 3–4 days apart would make that about ${Math.round(sv.other.swing * 100)}%: steadier, and often less nausea after a shot.` : null)
                    : `Splitting keeps your level steadier: it drops about ${Math.round(sv.swing * 100)}% before each shot, against ${Math.round(sv.other.swing * 100)}% with one shot a week.`}</p>
                  {(sv.perWeek > 1 || better > 0.1) && <SwingBars view={sv} yours />}
                </div>
              );
            })()}</>
          : guideEntry?.halfLifeHours
            ? <button type="button" className="w-full text-left rounded-card bg-surface-2 p-3 min-h-[56px]" onClick={async () => { await setHalfLife(med.id, guideEntry.halfLifeHours); toast(`Half-life set to ${Math.round(guideEntry.halfLifeHours! / 24)} days`, { onAction: () => setHalfLife(med.id, undefined) }); }}>
                <span className="block font-medium">Use the {guideEntry.name} half-life ({Math.round(guideEntry.halfLifeHours / 24)} days)</span>
                <span className="block text-sm text-muted">Shows your estimated level through the plan, and how steady it is between shots.</span>
              </button>
            : <p className="text-sm text-muted">Add a half-life on <a href={`#/meds/${med.id}`} className="underline underline-offset-4">its page</a> to see the estimated level through your plan.</p>}
      </section>

      {sheet === 'late' && <LateShotsSheet med={med} report={late ?? { events: [], basis: { weeks: 12 } }} onClose={() => setSheet(null)} />}
      {sheet === 'day' && <ShotDaySheet result={shotDay} busy={busy} onClose={() => setSheet(null)} />}
      {sheet === 'patterns' && <PatternsSheet findings={findings} weeks={weeksWithCheckIns} onClose={() => setSheet(null)} />}
      {sheet === 'start' && <StartVialSheet med={med} onClose={() => setSheet(null)} />}
      <Sheet open={sheet === 'log'} onClose={() => setSheet(null)} title={`Log ${shownMedName(med)}`}>
        {sheet === 'log' && <LogDoseFlow med={med} doses={doses} s={s} now={now} onLogged={onLogged} onCancel={() => setSheet(null)} people={people} defaultPersonId={personId} />}
      </Sheet>
    </>
  );
}

/** Stock rows for the peptide shown: unopened vials or pens and when to order, cost, and batches. */
function MedStock({ med, doses, s, now, body, checkIns }: { med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; body: Parameters<typeof lotStats>[2]; checkIns: Parameters<typeof lotStats>[3] }) {
  const [lots, setLots] = useState(false);
  const [leadSheet, setLeadSheet] = useState(false);
  const pen = isPen(med);
  const stock = stockVials(med).length;
  const sp = stockPlan(med, doses, now, s);
  const orderSoon = sp.orderBy !== null && sp.orderBy - now < 3 * DAY;
  const batches = lotStats(med, doses, body, checkIns, now);
  const c = costSummary(med, doses, now, s);
  return (
    <>
      <Row label={pen ? 'Pens' : 'Vials'} onClick={() => setLeadSheet(true)}>
        <span className="tnum">{stock} unopened</span>
        {sp.forecast?.runOutAt != null
          ? <span className={`block text-sm tnum ${orderSoon ? 'text-caution font-medium' : 'text-muted'}`}>Order by {day(sp.orderBy!)} · runs out {day(sp.forecast.runOutAt)}</span>
          : <span className="block text-sm text-muted">{sp.forecast ? 'Enough for over a year' : 'Add a stock count to forecast'}</span>}
      </Row>
      {c && <Row label="Cost" onClick={() => go(`/meds/${med.id}`)}>
        {<>
          <span className="tnum">{c.perWeek !== undefined ? `${money(c.perWeek)} a week` : c.perUnit !== undefined ? `${money(c.perUnit)} per ${med.unit}` : `${money(c.spent)} so far`}</span>
          {c.next12Weeks !== undefined && <span className="block text-sm text-muted tnum">Next 12 weeks {money(c.next12Weeks)} with your plan</span>}
        </>}
      </Row>}
      {(() => {
        const per = HAS_BODY ? costPerKg(med, doses, body, checkIns, now) : [];
        return per.length > 0 && (
          <Row label="Per kg lost">
            {per.map((x) => <span key={x.dose} className="block tnum">{money(x.perKg)} <span className="text-sm text-muted">on {fmtAmount(x.dose, med.unit)} ({x.kgLost} kg in {x.weeks} wk)</span></span>)}
          </Row>
        );
      })()}
      {batches.length > 0 && (
        <Row label="Batches" onClick={() => setLots(true)}>
          <span className="tnum">{batches.length} used</span>
          {batches.some((b) => b.flag) && <span className="block text-sm text-caution font-medium">{batches.filter((b) => b.flag).length} flagged</span>}
        </Row>
      )}
      {lots && <LotSheet med={med} batches={batches} onClose={() => setLots(false)} />}
      {leadSheet && <LeadTimeSheet med={med} onClose={() => setLeadSheet(false)} />}
    </>
  );
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

