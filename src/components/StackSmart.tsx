// The stack made smarter, on screen. On the Stack tab: every peptide's estimated level on one chart, the courses on
// one calendar, and one shopping list for the whole stack (with orders placed and arrived, so delivery time is
// learned). On a peptide's Stock tab: a vial mixed to a new strength, what vials actually give, and time out of the
// fridge. On its Plan tab: a course's summary. (Each batch on the peptide's goal is in the Batches sheet.)
import { useState } from 'react';
import { format } from 'date-fns';
import { CalendarRange, FlaskConical, Layers, PackageCheck, Snowflake, Sparkles, Truck } from 'lucide-react';
import type { Medication } from '../db/schema';
import { useDecisionData } from '../app/useDecisions';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { setSetting } from '../db/repos/settings';
import { updateVial } from '../db/repos/meds';
import { currentVial } from '../logic/peptide';
import { plannedDoses } from '../logic/protocol';
import { medColour } from '../logic/palette';
import { shownColour } from '../logic/privacy';
import { fmtAmount } from '../logic/format';
import { shortActing, courseCalendar, courseLine, courseSummary, fridgeNote, stackLevels, stackShop, strengthChange, vialYield } from '../logic/stackSmart';
import { Sheet, SheetActions } from './ui/Sheet';
import { Button } from './ui/Button';
import { useSupplies } from '../app/data';
import { StockOutlookCard } from './RealUse';
import { DoseStripsCard, FridgeShelfCard } from './Graphics';

const DAY = 86_400_000;
const fmtDay = (t: number) => format(t, 'EEE d MMM');

// ── Stack tab ─────────────────────────────────────────────────────────────────────────────────────────

/** The stack at a glance: levels, courses and what to order. Only with two or more peptides for the levels. */
export function StackToday() {
  const dd = useDecisionData();
  const now = useNow(600_000);
  if (!dd || dd.everyone) return null;
  const { data, s } = dd;
  const peps = data.meds.filter((m) => m.peptide && !m.archived);
  if (!peps.length) return null;
  const levels = stackLevels(data.meds, data.doses, now, (m) => plannedDoses(m, data.doses, now, now + 7 * DAY, s));
  const cal = courseCalendar(data.meds, now, s);
  return (
    <>
      {levels.length > 0 && <LevelsCard levels={levels} now={now} short={shortActing(data.meds).map((m) => m.nickname?.trim() || m.name)} />}
      {cal.bars.some((b) => b.med.schedule.course) && <CalendarCard cal={cal} now={now} />}
      <FridgeShelfCard />
      <ShopCard />
      <StockOutlookCard />
      <DoseStripsCard />
    </>
  );
}

function LevelsCard({ levels, now, short }: { levels: ReturnType<typeof stackLevels>; now: number; short: string[] }) {
  const W = 320, H = 120, pad = 6;
  const t0 = now - 14 * DAY, t1 = now + 7 * DAY;
  const x = (t: number) => pad + ((t - t0) / (t1 - t0)) * (W - 2 * pad);
  const y = (p: number) => pad + (1 - p / 100) * (H - 2 * pad);
  return (
    <section className="box space-y-2" aria-labelledby="lv-h">
      <h2 id="lv-h" className="font-semibold flex items-center gap-1.5"><Layers size={16} aria-hidden="true" />In your system</h2>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: H }} role="img"
        aria-label={`Estimated level of each peptide, 2 weeks back to 1 week ahead, as a share of its own peak: ${levels.map((l) => `${l.name} ${l.nowPct}% now`).join(', ')}`}>
        {[25, 50, 75].map((p) => <line key={p} x1={pad} x2={W - pad} y1={y(p)} y2={y(p)} stroke="var(--border)" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        <rect x={x(now)} y={0} width={x(t1) - x(now)} height={H} fill="var(--fill)" opacity="0.6" />
        {levels.map((l) => (
          <path key={l.med.id} d={l.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.pct).toFixed(1)}`).join('')}
            fill="none" stroke={medColour(shownColour(l.med))} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        ))}
        <line x1={x(now)} x2={x(now)} y1={0} y2={H} stroke="var(--text)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="relative h-4 text-[11px] text-muted" aria-hidden="true">
        <span className="absolute left-0">2 weeks ago</span>
        <span className="absolute -translate-x-1/2" style={{ left: `${(14 / 21) * 100}%` }}>Now</span>
        <span className="absolute right-0">+1 week</span>
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {levels.map((l) => (
          <li key={l.med.id} className="inline-flex items-center gap-1.5 tnum"><span aria-hidden="true" className="w-3 h-1 rounded-full" style={{ background: medColour(shownColour(l.med)) }} />{l.name} <span className="font-semibold">{l.nowPct}%</span></li>
        ))}
      </ul>
      {short.length > 0 && <p className="text-[13px] text-muted">{short.join(', ')}: gone within a day of each shot, so not drawn.</p>}
      <p className="text-[12px] text-muted">Each as a share of its own peak, from your doses and its half-life. An estimate.</p>
    </section>
  );
}

function CalendarCard({ cal, now }: { cal: ReturnType<typeof courseCalendar>; now: number }) {
  const pct = (t: number) => ((t - cal.from) / (cal.to - cal.from)) * 100;
  const notes = cal.bars.filter((b) => b.overlapNote);
  return (
    <section className="box space-y-2" aria-labelledby="cal-h">
      <h2 id="cal-h" className="font-semibold flex items-center gap-1.5"><CalendarRange size={16} aria-hidden="true" />Courses</h2>
      <ul className="space-y-2">
        {cal.bars.map((b) => (
          <li key={b.med.id}>
            <p className="text-[13px] font-medium mb-0.5">{b.name}</p>
            <div className="relative h-3 rounded-full" style={{ background: 'var(--fill)' }} role="img"
              aria-label={`${b.name}: ${b.spans.map((x) => `${x.kind === 'on' ? 'on' : 'break'} ${fmtDay(x.from)} to ${fmtDay(x.to)}`).join(', ')}`}>
              {b.spans.map((x, i) => (
                <div key={i} className="absolute inset-y-0 rounded-full" style={{ left: `${pct(x.from)}%`, width: `${Math.max(1, pct(x.to) - pct(x.from))}%`,
                  background: x.kind === 'on' ? medColour(shownColour(b.med)) : 'transparent', border: x.kind === 'break' ? '1.5px dashed var(--border-strong)' : undefined }} />
              ))}
              <div className="absolute -top-1 -bottom-1 w-0.5 bg-text" style={{ left: `${pct(now)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex justify-between text-[11px] text-muted"><span>{format(cal.from, 'd MMM')}</span><span>Today</span><span>{format(cal.to, 'd MMM')}</span></div>
      <p className="text-[12px] text-muted">Solid: on a course. Dashed: a break.</p>
      {notes.map((b) => <p key={b.med.id} className="text-[14px] rounded-btn bg-surface-2 p-2.5">{b.name}: {b.overlapNote}</p>)}
    </section>
  );
}

/** One list for the whole stack, and the order log that teaches delivery time. */
export function ShopCard() {
  const dd = useDecisionData();
  const supplies = useSupplies();
  const tracked = (supplies ?? []).some((x) => !x.deletedAt && x.kind !== 'sharps');
  const now = useNow(600_000);
  const toast = useToast();
  if (!dd || dd.everyone) return null;
  const { data, s, settings } = dd;
  const orders = settings.peptideOrders;
  const shop = stackShop(data.meds, data.doses, now, s, orders);
  if (!shop) return null;
  const open = orders.find((o) => !o.arrivedAt);
  const toBuy = shop.items.filter((x) => x.vials > 0);
  const placed = async () => {
    const o = { id: crypto.randomUUID(), placedAt: new Date().toISOString(), note: toBuy.map((x) => `${x.vials} × ${x.name}`).join(', ') || undefined };
    await setSetting('peptideOrders', [o, ...orders].slice(0, 50));
    toast('Order noted. Tap “It’s arrived” when it comes.', { onAction: () => setSetting('peptideOrders', orders) });
  };
  const arrived = async () => {
    if (!open) return;
    await setSetting('peptideOrders', orders.map((o) => (o.id === open.id ? { ...o, arrivedAt: new Date().toISOString() } : o)));
    toast(`Arrived after ${Math.max(1, Math.round((Date.now() - Date.parse(open.placedAt)) / DAY))} days. Add the vials on each peptide's Stock tab.`);
  };
  return (
    <section className="box space-y-3" aria-labelledby="shop-h">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="shop-h" className="font-semibold flex items-center gap-1.5"><Truck size={16} aria-hidden="true" />To buy for the stack</h2>
        {shop.orderBy !== undefined && <span className={`text-[13px] font-medium tnum ${shop.orderBy - now < 3 * DAY ? 'text-caution' : 'text-muted'}`}>Order by {fmtDay(Math.max(now, shop.orderBy))}</span>}
      </div>
      {toBuy.length ? (
        <ul className="divide-y divide-border">
          {toBuy.map((x) => (
            <li key={x.med.id} className="py-2 flex items-center gap-3">
              <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: medColour(shownColour(x.med)) }} />
              <span className="flex-1 min-w-0"><span className="block font-medium">{x.name}</span><span className="block text-[13px] text-muted tnum">{x.runsOutAt ? `Runs out ${fmtDay(x.runsOutAt)}` : ''}</span></span>
              <span className="font-semibold tnum shrink-0">{x.vials} × {fmtAmount(x.vialSize, x.unit)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[15px] text-success font-medium">Enough vials for every peptide's plan.</p>}
      {/* With supplies tracked, water and syringes are in "Medicines and supplies to order" below, by when to order them. */}
      {!tracked && (shop.waterMl > 0 || shop.syringes > 0) && (
        <p className="text-[15px] tnum">{[shop.waterMl > 0 ? `${shop.waterMl} mL bacteriostatic water` : null, shop.syringes ? `${shop.syringes} syringes` : null, shop.swabs ? `${shop.swabs} swabs` : null].filter(Boolean).join(' · ')}</p>
      )}
      <p className="text-[12px] text-muted">For each peptide's plan (its course, or the next 4 weeks). Delivery: {shop.leadDays} days{shop.learned ? ', learned from your orders' : ' (tap below when you order to learn yours)'}.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" className="min-h-[44px]" onClick={placed}>I've ordered</Button>
        <Button variant="secondary" className="min-h-[44px]" disabled={!open} onClick={arrived}><PackageCheck size={16} aria-hidden="true" className="inline mr-1 -mt-0.5" />It's arrived</Button>
      </div>
    </section>
  );
}

// ── A peptide's Stock tab ─────────────────────────────────────────────────────────────────────────────

export function VialExtras({ med }: { med: Medication }) {
  const dd = useDecisionData();
  const toast = useToast();
  const [out, setOut] = useState(false);
  if (!dd || !med.peptide || med.peptide.kind === 'pen') return null;
  const sc = strengthChange(med);
  const y = vialYield(med, dd.data.doses);
  const cur = currentVial(med);
  const fridge = fridgeNote(cur);
  if (!sc && !y && !cur) return null;
  const logOut = async (hours: number) => {
    if (!cur) return;
    const before = cur.excursions;
    await updateVial(med.id, cur.id, { excursions: [...(cur.excursions ?? []), { at: new Date().toISOString(), hours }] });
    setOut(false);
    toast(`Noted: ${hours} hour${hours === 1 ? '' : 's'} out of the fridge`, { onAction: () => updateVial(med.id, cur.id, { excursions: before }) });
  };
  return (
    <section className="box space-y-3" aria-labelledby={`vx-${med.id}`}>
      <h2 id={`vx-${med.id}`} className="text-sm font-medium text-muted flex items-center gap-1.5"><FlaskConical size={15} aria-hidden="true" />Your vials</h2>
      {sc && (
        <div className={`rounded-btn p-3 space-y-1 ${sc.checked ? 'bg-surface-2' : 'bg-caution-soft'}`}>
          <p className="font-semibold tnum">This vial: {sc.unitsNow} units a {fmtAmount(med.defaultAmount, med.unit)} dose (the last was {sc.unitsWas})</p>
          <p className="text-[14px] tnum">Mixed to {sc.now} {med.unit}/mL against {sc.was} before.</p>
          {!sc.checked && <button type="button" className="min-h-[40px] px-3 rounded-btn bg-surface font-semibold text-[14px]" onClick={() => updateVial(med.id, sc.vial.id, { checkedAt: new Date().toISOString() })}>Got it</button>}
        </div>
      )}
      {y && (
        <p className="text-[15px] tnum">Your vials give about <strong>{y.actual} doses</strong>, not the {y.expected} their amount would: about {fmtAmount(y.lossPerVial, med.unit)} ({Math.round(y.share * 100)}%) is lost per vial, from {y.vials} vials. The shopping list counts on what they really give.</p>
      )}
      {cur && (
        <div className="flex items-center gap-3">
          <Snowflake size={18} aria-hidden="true" className="text-muted shrink-0" />
          <p className="flex-1 text-[15px]">{fridge ?? 'Kept in the fridge'}</p>
          <button type="button" className="min-h-[44px] px-3 rounded-btn bg-surface-2 font-medium text-[14px]" onClick={() => setOut(true)}>Left out</button>
        </div>
      )}
      <Sheet open={out} onClose={() => setOut(false)} title="Out of the fridge for about">
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 4, 8, 12, 24].map((h) => <Button key={h} variant="secondary" className="min-h-[52px]" onClick={() => logOut(h)}>{h === 24 ? 'A day' : `${h} h`}</Button>)}
        </div>
        <SheetActions><Button variant="secondary" className="w-full" onClick={() => setOut(false)}>Cancel</Button></SheetActions>
      </Sheet>
    </section>
  );
}

// ── A peptide's Plan tab ──────────────────────────────────────────────────────────────────────────────

export function PeptideInsights({ med }: { med: Medication }) {
  const dd = useDecisionData();
  const now = useNow(3_600_000);
  if (!dd) return null;
  const { data, s } = dd;
  const cs = courseSummary(med, data, now, s);
  if (!cs) return null;
  return (
    <>
      {cs && (
        <section className="box space-y-1" aria-labelledby={`cs-${med.id}`}>
          <h2 id={`cs-${med.id}`} className="font-semibold flex items-center gap-1.5"><Sparkles size={16} aria-hidden="true" />{cs.ended ? 'The last course' : 'This course so far'}</h2>
          <p className="text-[15px] tnum">{courseLine(cs)}</p>
          {cs.better !== undefined && <p className={`text-[14px] font-medium ${cs.better ? 'text-success' : 'text-muted'}`}>{cs.better ? 'Better than before it' : 'No better than before it'}{cs.ended ? `; ended ${format(new Date(`${cs.lastDay}T12:00`), 'd MMM')}` : ''}.</p>}
        </section>
      )}
    </>
  );
}
