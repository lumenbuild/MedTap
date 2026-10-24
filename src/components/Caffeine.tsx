// Caffeine on Today: the day's total against the person's limit, about how much is still in them (a curve to bedtime),
// and when it drops under the low line; and the sheet to log a drink (their usual ones first, then common drinks,
// or anything else by name and mg) or change one.
import { useState } from 'react';
import { Coffee, RotateCcw } from 'lucide-react';
import type { CheckIn, DailyHealth } from '../db/schema';
import type { ScheduleSettings } from '../logic/schedule';
import { CAFFEINE, CHECK_DAYS, DRINKS, usualKey, type UsualHabit, LOW_MG, bedtimeOf, curve, dayTotal, level, lowBy, usualDrinks, type Intake } from '../logic/caffeine';
import { getDayBounds } from '../logic/schedule';
import { fmtTime, toLocalInput } from '../logic/format';
import { addCheckIn, removeCheckIn, restoreCheckIn, updateCheckIn } from '../db/repos/checkIns';
import { useToast } from '../app/toast';
import { Sheet, SheetActions } from './ui/Sheet';
import { Button } from './ui/Button';
import { TextInput } from './ui/Field';
import { Bar } from './ui/Visual';

const HOUR = 3_600_000;

export interface CaffeinePrefs { limit: number | null; bedtime: string; halfLifeH: number; cutoff: string | null; checkFrom: number | null }

/** What to say after a drink is logged: how much is likely still in at bedtime if that's a lot, else the day's total. */
function afterLog(all: Intake[], added: Intake, p: CaffeinePrefs, s: ScheduleSettings): string {
  const xs = [...all, added].sort((a, b) => a.t - b.t);
  const bed = bedtimeOf(added.t, p.bedtime, s);
  const atBed = Math.round(level(xs, bed, p.halfLifeH));
  const cut = p.cutoff ? bedtimeOf(added.t, p.cutoff, s) : null;
  const late = cut !== null && added.t >= cut ? ` (after your ${fmtTime(cut)} cut-off)` : '';
  if (added.t < bed && atBed >= LOW_MG) return `about ${atBed} mg likely still in you at ${fmtTime(bed)}${late}`;
  return `${dayTotal(xs, added.t, s)} mg today${late}`;
}

/** Today's caffeine card. Shown once there's caffeine today or still some in the body. */
export function CaffeineCard({ intakes, prefs, now, s, onLog }: { intakes: Intake[]; prefs: CaffeinePrefs; now: number; s: ScheduleSettings; onLog: () => void }) {
  const toast = useToast();
  const total = dayTotal(intakes, now, s);
  const inYou = Math.round(level(intakes, now, prefs.halfLifeH));
  if (!total && inYou < 5) return null;
  const bed = bedtimeOf(now, prefs.bedtime, s);
  const low = lowBy(intakes, now, prefs.halfLifeH);
  const atBed = Math.round(level(intakes, bed, prefs.halfLifeH));
  const last = intakes.filter((x) => x.t <= now).at(-1);
  const over = prefs.limit !== null && total > prefs.limit;
  const cut = prefs.cutoff ? bedtimeOf(now, prefs.cutoff, s) : null;
  const checkDay = prefs.checkFrom ? Math.floor((now - prefs.checkFrom) / (24 * HOUR)) + 1 : 0;
  const again = async () => {
    if (!last) return;
    const c = await addCheckIn({ at: new Date().toISOString(), chips: [CAFFEINE], note: last.name, caffeineMg: last.mg, personId: last.personId });
    toast(`${last.name ?? 'Caffeine'} · ${last.mg} mg: ${afterLog(intakes, { id: c.id, t: Date.parse(c.at), mg: last.mg }, prefs, s)}`, { onAction: () => removeCheckIn(c.id) });
  };
  return (
    <section className="border-t border-border pt-4 space-y-3" aria-labelledby="caf-h">
      <div className="flex items-center gap-2">
        <Coffee size={18} aria-hidden="true" className="text-primary" />
        <h2 id="caf-h" className="font-medium flex-1">Caffeine</h2>
        <span className="tnum"><span className="text-[20px] font-semibold">{total}</span><span className="text-sm text-muted">{prefs.limit ? ` / ${prefs.limit}` : ''} mg today</span></span>
      </div>
      {prefs.limit ? <Bar value={total} max={prefs.limit} tone={over ? 'watch' : 'primary'} label={`${total} of your ${prefs.limit} mg today`} /> : null}
      <LevelChart intakes={intakes} now={now} bed={bed} cut={cut} s={s} halfLifeH={prefs.halfLifeH} />
      <p className="text-[15px]">
        About <span className="font-semibold tnum">{inYou} mg</span> in you now.{' '}
        {low === null ? null
          : low <= bed ? <span className="text-muted">Under {LOW_MG} mg by {fmtTime(low)}, before your {fmtTime(bed)} bedtime.</span>
          : <span className="text-caution">About {atBed} mg likely still in you at your {fmtTime(bed)} bedtime; under {LOW_MG} mg by {fmtTime(low)}.</span>}
        {cut !== null && <span className="text-muted">{' '}Your cut-off: {fmtTime(cut)}.</span>}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onLog}>Log a drink</Button>
        {last?.name && <Button variant="secondary" className="flex items-center justify-center gap-1.5 min-w-0" onClick={again} aria-label={`Again: ${last.name}, ${last.mg} mg`}>
          <RotateCcw size={16} aria-hidden="true" className="shrink-0" /><span className="truncate">{last.name}</span></Button>}
      </div>
      <a href="#/caffeine" className="block text-sm font-medium underline underline-offset-4 min-h-[44px] flex items-center">
        {checkDay >= 1 && checkDay <= CHECK_DAYS ? `Caffeine check: day ${checkDay} of ${CHECK_DAYS}` : 'Find your cut-off and limit'}
      </a>
    </section>
  );
}

/** "Same as usual?": drinks had at about the same time most days that aren't logged yet today. Yes logs it at the
 *  usual time; Not today leaves it for today. */
export function UsualCard({ asks, personId, now, s, onNotToday }: { asks: UsualHabit[]; personId?: string; now: number; s: ScheduleSettings; onNotToday: (key: string) => void }) {
  const toast = useToast();
  if (!asks.length) return null;
  const start = getDayBounds(now, s.dayStartsAt, s.tz).start;
  const yes = async (h: UsualHabit) => {
    const c = await addCheckIn({ at: new Date(Math.min(h.at, Date.now())).toISOString(), chips: [CAFFEINE], note: h.name, caffeineMg: h.mg, personId });
    toast(`${h.name} logged at ${fmtTime(h.at)}`, { onAction: () => removeCheckIn(c.id) });
  };
  return (
    <section className="border-t border-border pt-4 space-y-2" aria-labelledby="usual-h">
      <h2 id="usual-h" className="font-medium">Same as usual?</h2>
      <ul className="space-y-2">
        {asks.map((h) => (
          <li key={h.name} className="flex items-center gap-3">
            <Coffee size={18} aria-hidden="true" className="text-primary shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block truncate">{h.name}</span>
              <span className="block text-sm text-muted tnum">About {fmtTime(h.at)} · {h.mg} mg</span>
            </span>
            <Button className="min-h-[44px]" onClick={() => yes(h)} aria-label={`Yes, I had ${h.name}`}>Yes</Button>
            <Button variant="secondary" className="min-h-[44px]" onClick={() => onNotToday(usualKey(h, start))} aria-label={`Not today: ${h.name}`}>Not today</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** During a caffeine check, each morning until last night's sleep is recorded: how did you sleep, in one tap. */
export function SleepAsk({ checkIns, daily, personId, checkFrom, now, s }: {
  checkIns: CheckIn[]; daily: DailyHealth[]; personId?: string; checkFrom: number | null; now: number; s: ScheduleSettings;
}) {
  const toast = useToast();
  if (!checkFrom || now - checkFrom > CHECK_DAYS * 24 * HOUR || now - checkFrom < 6 * HOUR) return null;
  const { start } = getDayBounds(now, s.dayStartsAt, s.tz);
  if (now > start + 10 * HOUR) return null; // mornings only
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: s.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  if (daily.some((d) => !d.deletedAt && d.date === today && d.sleepMin)) return null;
  if (checkIns.some((c) => !c.deletedAt && Date.parse(c.at) >= start - 2 * HOUR && (c.sleepQuality !== undefined || c.sleepHours !== undefined))) return null;
  const answer = async (q: number) => {
    const c = await addCheckIn({ at: new Date().toISOString(), chips: [], sleepQuality: q, personId });
    toast('Sleep noted for your caffeine check', { onAction: () => removeCheckIn(c.id) });
  };
  return (
    <section className="border-t border-border pt-4 space-y-2" aria-labelledby="sleep-ask-h">
      <h2 id="sleep-ask-h" className="font-medium">How did you sleep?</h2>
      <p className="text-sm text-muted">For your caffeine check.</p>
      <div className="grid grid-cols-5 gap-2">
        {['Poor', 'Fair', 'OK', 'Good', 'Great'].map((l, i) => (
          <button key={l} type="button" onClick={() => answer(i + 1)} className="min-h-[48px] rounded-chip bg-surface-2 text-sm font-medium">{l}</button>
        ))}
      </div>
    </section>
  );
}

/** The estimated level from the start of the day (or a little before the first drink) to after bedtime, with now,
 *  bedtime and the low line marked. */
function LevelChart({ intakes, now, bed, cut, s, halfLifeH }: { intakes: Intake[]; now: number; bed: number; cut: number | null; s: ScheduleSettings; halfLifeH: number }) {
  const { start } = getDayBounds(now, s.dayStartsAt, s.tz);
  const first = intakes.find((x) => x.t >= start - 12 * HOUR && level(intakes, x.t + HOUR, halfLifeH) >= 5);
  const from = Math.max(start, Math.min(now - 2 * HOUR, (first?.t ?? now) - HOUR));
  const to = Math.max(bed + 2 * HOUR, now + 3 * HOUR);
  const pts = curve(intakes, from, to, halfLifeH, 10);
  const max = Math.max(LOW_MG * 2, ...pts.map((p) => p.v)) * 1.1;
  const W = 340, H = 110, L = 4, R = 336, T = 14, B = 92;
  const X = (t: number) => L + ((t - from) / (to - from)) * (R - L);
  const Y = (v: number) => B - (v / max) * (B - T);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join('');
  const past = pts.filter((p) => p.t <= now);
  const peak = pts.reduce((a, p) => (p.v > a.v ? p : a), pts[0]);
  const label = `Estimated caffeine in you: about ${Math.round(level(intakes, now, halfLifeH))} mg now, peaking at about ${Math.round(peak.v)} mg at ${fmtTime(peak.t)}, about ${Math.round(level(intakes, bed, halfLifeH))} mg at bedtime ${fmtTime(bed)}.`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={label}>
      <line x1={L} x2={R} y1={B} y2={B} stroke="var(--border)" />
      <line x1={L} x2={R} y1={Y(LOW_MG)} y2={Y(LOW_MG)} stroke="var(--text-muted)" strokeDasharray="3 4" strokeWidth="1" />
      <text x={R} y={Y(LOW_MG) - 4} fontSize="10" textAnchor="end" fill="var(--text-muted)">{LOW_MG} mg</text>
      <path d={`${path}L${X(to)} ${B}L${X(from)} ${B}Z`} fill="var(--primary)" fillOpacity="0.08" />
      <path d={path} fill="none" stroke="var(--primary)" strokeWidth="2" strokeOpacity="0.45" strokeDasharray="4 3" />
      {past.length > 1 && <path d={past.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)} ${Y(p.v).toFixed(1)}`).join('')} fill="none" stroke="var(--primary)" strokeWidth="2.5" />}
      <line x1={X(bed)} x2={X(bed)} y1={T - 6} y2={B} stroke="var(--text)" strokeWidth="1" strokeDasharray="2 3" />
      <text x={Math.min(X(bed), R - 30)} y={T - 6} fontSize="10" textAnchor="middle" fill="var(--text-muted)">Bed {fmtTime(bed)}</text>
      {cut !== null && cut > from && cut < to && <>
        <line x1={X(cut)} x2={X(cut)} y1={T} y2={B} stroke="var(--caution)" strokeWidth="1" strokeDasharray="2 3" />
        <text x={X(cut)} y={B - 4} fontSize="10" textAnchor="middle" fill="var(--text-muted)" transform={`rotate(-90 ${X(cut) - 3} ${B - 4})`}>Cut-off</text>
      </>}
      <circle cx={X(now)} cy={Y(level(intakes, now, halfLifeH))} r="4" fill="var(--primary)" stroke="var(--surface)" strokeWidth="2" />
      <text x={L} y={B + 14} fontSize="10" fill="var(--text-muted)">{fmtTime(from)}</text>
      <text x={X(now)} y={B + 14} fontSize="10" textAnchor="middle" fill="var(--text-muted)">Now</text>
      <text x={R} y={B + 14} fontSize="10" textAnchor="end" fill="var(--text-muted)">{fmtTime(to)}</text>
    </svg>
  );
}

/** Log a caffeine drink (tapping one logs it), or change or remove one already logged. */
export function CaffeineSheet({ open, onClose, intakes, prefs, s, personId, editing }: {
  open: boolean; onClose: () => void; intakes: Intake[]; prefs: CaffeinePrefs; s: ScheduleSettings; personId?: string; editing?: CheckIn | null;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={editing ? 'Change drink' : 'Log caffeine'}>
      {open && (editing ? <EditDrink c={editing} onClose={onClose} /> : <NewDrink intakes={intakes} prefs={prefs} s={s} personId={personId} onClose={onClose} />)}
    </Sheet>
  );
}

function NewDrink({ intakes, prefs, s, personId, onClose }: { intakes: Intake[]; prefs: CaffeinePrefs; s: ScheduleSettings; personId?: string; onClose: () => void }) {
  const toast = useToast();
  const now = Date.now();
  const [earlier, setEarlier] = useState(false);
  const [when, setWhen] = useState(toLocalInput(now));
  const [name, setName] = useState('');
  const [mg, setMg] = useState('');
  const usual = usualDrinks(intakes, now);
  const log = async (drink: string, amount: number) => {
    const t = earlier && when ? Math.min(Date.now(), new Date(when).getTime()) : Date.now();
    const c = await addCheckIn({ at: new Date(t).toISOString(), chips: [CAFFEINE], note: drink, caffeineMg: Math.round(amount), personId });
    onClose();
    toast(`${drink} · ${Math.round(amount)} mg: ${afterLog(intakes, { id: c.id, t, mg: amount }, prefs, s)}`, { onAction: () => removeCheckIn(c.id) });
  };
  const DrinkButton = ({ d }: { d: { name: string; mg: number } }) => (
    <li>
      <button type="button" onClick={() => log(d.name, d.mg)} className="w-full min-h-[52px] flex items-center gap-3 px-3 rounded-btn bg-surface-2 text-left">
        <span className="flex-1 min-w-0">{d.name}</span>
        <span className="text-sm text-muted tnum shrink-0">{d.mg} mg</span>
      </button>
    </li>
  );
  const groups = [...new Set(DRINKS.map((d) => d.group))];
  const n = Number(mg);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 min-h-[48px]">
        {!earlier ? (
          <>
            <span className="tnum text-muted">Now · {fmtTime(now)}</span>
            <button type="button" onClick={() => setEarlier(true)} className="min-h-[48px] px-3 -mr-3 text-primary font-semibold">Earlier?</button>
          </>
        ) : (
          <input type="datetime-local" aria-label="When you had it" value={when} max={toLocalInput(now)} onChange={(e) => setWhen(e.target.value)}
            className="flex-1 min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
        )}
      </div>
      {usual.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted mb-2">Your usual</h3>
          <ul className="space-y-2">{usual.map((d) => <DrinkButton key={`${d.name}|${d.mg}`} d={d} />)}</ul>
        </div>
      )}
      {groups.map((g) => (
        <div key={g}>
          <h3 className="text-sm font-medium text-muted mb-2">{g}</h3>
          <ul className="space-y-2">{DRINKS.filter((d) => d.group === g).map((d) => <DrinkButton key={d.name} d={d} />)}</ul>
        </div>
      ))}
      <div>
        <h3 className="text-sm font-medium text-muted mb-2">Something else</h3>
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <TextInput label="Drink" value={name} onChange={(e) => setName(e.target.value)} placeholder="Long black, large" />
          <TextInput label="Caffeine (mg)" type="number" inputMode="numeric" min="0" value={mg} onChange={(e) => setMg(e.target.value)} />
        </div>
        <Button className="w-full mt-3" disabled={!name.trim() || !(n > 0)} onClick={() => log(name.trim(), n)}>Log {name.trim() || 'it'}</Button>
      </div>
      <p className="text-xs text-muted">Amounts are typical; café coffee varies a lot by beans and shop. A drink you make with your own name and amount becomes one of your usual ones.</p>
    </div>
  );
}

function EditDrink({ c, onClose }: { c: CheckIn; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(c.note ?? 'Caffeine');
  const [mg, setMg] = useState(String(c.caffeineMg ?? ''));
  const [when, setWhen] = useState(toLocalInput(Date.parse(c.at)));
  const n = Number(mg);
  const save = async () => {
    const { id: _id, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = c;
    await updateCheckIn(c.id, { ...rest, note: name.trim() || undefined, caffeineMg: n > 0 ? Math.round(n) : undefined, at: new Date(when).toISOString() });
    onClose();
    toast('Drink changed');
  };
  const del = async () => {
    await removeCheckIn(c.id);
    onClose();
    toast(`${c.note ?? 'Caffeine'} removed`, { onAction: () => restoreCheckIn(c.id) });
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[1fr_7rem] gap-3">
        <TextInput label="Drink" value={name} onChange={(e) => setName(e.target.value)} />
        <TextInput label="Caffeine (mg)" type="number" inputMode="numeric" min="0" value={mg} onChange={(e) => setMg(e.target.value)} placeholder="Not set" />
      </div>
      <input type="datetime-local" aria-label="When you had it" value={when} max={toLocalInput(Date.now())} onChange={(e) => setWhen(e.target.value)}
        className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
      <SheetActions>
        <Button className="w-full min-h-[56px]" onClick={save} disabled={!when}>Save changes</Button>
      </SheetActions>
      <Button variant="danger" className="w-full" onClick={del}>Remove this drink</Button>
    </div>
  );
}
