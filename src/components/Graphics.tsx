// The app's pictures (numbers from logic/graphics.ts): your usual day as a clock, heart rate as a heatmap, today against
// your usual, dose strips, the fridge shelf, the interaction map, the month in review, and the pattern in hard days.
// Plain SVG, one meaning per colour, a text line for screen readers.
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CalendarDays, Clock, Grid3x3, HeartPulse, Network, Refrigerator, Sparkles, Sunrise } from 'lucide-react';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useExperiments, useFamily, useMeds, useScheduleSettings, useWorkouts } from '../app/data';
import { medIsFor, personOf } from '../db/repos/people';
import { useNow } from '../app/useNow';
import { dayClock, doseStrips, fridgeShelf, hrHeatmap, monthRecap, todayAgainstUsual, type ClockMark } from '../logic/graphics';
import { interactions, type Level } from '../logic/interactions';
import { roughPattern } from '../logic/realUse';
import { shownColour, shownName } from '../logic/privacy';
import { medColour } from '../logic/palette';

const H = ({ id, Icon, children, right }: { id: string; Icon: typeof Clock; children: React.ReactNode; right?: React.ReactNode }) => (
  <div className="flex items-center gap-2">
    <h2 id={id} className="font-semibold text-[17px] flex items-center gap-2 flex-1"><Icon size={18} aria-hidden="true" className="text-primary" />{children}</h2>
    {right}
  </div>
);
const hh = (h: number) => { const x = ((Math.round(h * 60) / 60) % 24 + 24) % 24; const hr = Math.floor(x), mi = Math.round((x - hr) * 60); return format(new Date(2000, 0, 1, hr, mi), 'h:mm a').toLowerCase(); };
const FOCUS = ['#c2410c', '#ea7a2e', '#a3a3a3', '#5aa469', '#16833a'];

// ── 1. Your usual day, as a clock ──────────────────────────────────────────────────────────────────

export function DayClockCard() {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const workouts = useWorkouts(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(60_000);
  if (!meds || !doses || !checkIns || !daily || !workouts || !fam || !ss || fam.everyone) return null;
  const c = dayClock({ meds: meds.filter((m) => medIsFor(m, fam.personId)), doses, checkIns: checkIns.filter((x) => personOf(x) === fam.personId),
    daily: daily.filter((x) => personOf(x) === fam.personId), workouts: workouts.filter((x) => personOf(x) === fam.personId) }, now, ss[1]);
  if (!c.usual.length && !c.sleep) return null;
  const S = 330, cx = S / 2, cy = S / 2;
  const ang = (h: number) => ((h / 24) * 360 - 90) * (Math.PI / 180);
  const pt = (h: number, r: number) => [cx + r * Math.cos(ang(h)), cy + r * Math.sin(ang(h))] as const;
  const arc = (a: number, b: number, r: number) => {
    const span = ((b - a) % 24 + 24) % 24 || 24;
    const [x1, y1] = pt(a, r), [x2, y2] = pt(a + span, r);
    return `M ${x1} ${y1} A ${r} ${r} 0 ${span > 12 ? 1 : 0} 1 ${x2} ${y2}`;
  };
  const marks = (ms: ClockMark[], r: number) => ms.map((m, i) => {
    if (m.kind === 'focus') { const [x, y] = pt(m.h, r - 16); return <circle key={`f${i}`} cx={x} cy={y} r={3} fill={FOCUS[(m.value ?? 3) - 1]} opacity={0.85} />; }
    const [x, y] = pt(m.h, r);
    if (m.kind === 'drink') return <rect key={`c${i}`} x={x - 4.5} y={y - 4.5} width={9} height={9} transform={`rotate(45 ${x} ${y})`} fill="#7c4a1e" stroke="var(--surface)" strokeWidth={2} />;
    return <circle key={`d${i}`} cx={x} cy={y} r={5.5} fill={medColour(m.colour ?? '#2a78d6')} stroke="var(--surface)" strokeWidth={2} />;
  });
  const nowH = (() => { const d = new Date(now); return d.getHours() + d.getMinutes() / 60; })();
  const [hx, hy] = pt(nowH, 128);
  const label = `Usual day: asleep ${c.sleep ? `${hh(c.sleep.from)} to ${hh(c.sleep.to)}` : 'unknown'}; ${c.usual.filter((m) => m.kind === 'dose').map((m) => `${m.label} ${hh(m.h)}`).join(', ')}.`;
  return (
    <section className="box space-y-2" aria-labelledby="clock-h">
      <H id="clock-h" Icon={Clock}>Your day, against your usual</H>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[320px] mx-auto block" role="img" aria-label={label}>
        <circle cx={cx} cy={cy} r={118} fill="none" stroke="var(--fill, #eceff3)" strokeWidth={16} />
        <circle cx={cx} cy={cy} r={78} fill="none" stroke="var(--fill, #eceff3)" strokeWidth={12} />
        {c.sleep && <path d={arc(c.sleep.from, c.sleep.to, 118)} fill="none" stroke="var(--c-sleep, #6250d6)" strokeWidth={16} strokeLinecap="round" opacity={0.55} />}
        {c.todaySleep && <path d={arc(c.todaySleep.from, c.todaySleep.to, 78)} fill="none" stroke="var(--c-sleep, #6250d6)" strokeWidth={12} strokeLinecap="round" />}
        {c.walks.map((w, i) => <path key={`w${i}`} d={arc(w.from, w.to, 136)} fill="none" stroke="var(--c-heart, #e34948)" strokeWidth={4} strokeLinecap="round" opacity={0.18} />)}
        {c.todayWalks.map((w, i) => <path key={`tw${i}`} d={arc(w.from, w.to, 92)} fill="none" stroke="var(--c-heart, #e34948)" strokeWidth={4} strokeLinecap="round" />)}
        {[0, 6, 12, 18].map((h) => { const [x, y] = pt(h, 146); return <text key={h} x={x} y={y + 4} textAnchor="middle" fontSize={11} fill="var(--muted)">{h === 0 ? '12a' : h === 12 ? '12p' : h === 6 ? '6a' : '6p'}</text>; })}
        {marks(c.usual, 118)}
        {marks(c.today, 78)}
        <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="var(--text)" strokeWidth={2} strokeLinecap="round" opacity={0.7} />
        <circle cx={cx} cy={cy} r={40} fill="var(--surface)" />
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={17} fontWeight={700} fill="var(--text)">{format(now, 'h:mm')}</text>
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize={11} fill="var(--muted)">{format(now, 'a').toLowerCase()}</text>
      </svg>
      <p className="text-[13px] text-center"><strong>Outer ring:</strong> your usual 2 weeks · <strong>inner:</strong> today</p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted justify-center">
        <li className="inline-flex items-center gap-1"><span className="w-3 h-2 rounded-full" style={{ background: 'var(--c-sleep, #6250d6)' }} />Sleep</li>
        <li className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#2a78d6' }} />Doses (their colour)</li>
        <li className="inline-flex items-center gap-1"><span className="w-2 h-2 rotate-45" style={{ background: '#7c4a1e' }} />Caffeine</li>
        <li className="inline-flex items-center gap-1"><span className="w-3 h-1 rounded-full" style={{ background: 'var(--c-heart, #e34948)' }} />Walks</li>
        <li className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: FOCUS[0] }} /><span className="w-2 h-2 rounded-full -ml-0.5" style={{ background: FOCUS[4] }} />Focus, scattered to sharp</li>
      </ul>
    </section>
  );
}

// ── 2. Heart rate as a heatmap ─────────────────────────────────────────────────────────────────────

export function HrHeatmapCard() {
  const daily = useDaily(); const doses = useDoses(); const meds = useMeds(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(3_600_000);
  const rows = useMemo(() => (daily && doses && meds && fam && ss ? hrHeatmap(daily.filter((x) => personOf(x) === fam.personId), doses, meds.filter((m) => medIsFor(m, fam.personId)), ss[1], 90, now) : []), [daily, doses, meds, fam, ss, now]);
  if (rows.length < 14) return null;
  const vals = rows.flatMap((r) => r.hours.filter((v): v is number => v !== null)).sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.floor(vals.length * 0.95)];
  const W = 320, L = 34, cw = (W - L - 4) / 24, rh = Math.max(2, Math.min(5, 300 / rows.length)), Hh = rows.length * rh + 18;
  const shade = (v: number) => { const f = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1))); return `rgba(214, 51, 64, ${0.08 + f * 0.85})`; };
  return (
    <section className="box space-y-2" aria-labelledby="heat-h">
      <H id="heat-h" Icon={Grid3x3}>Heart rate, every hour</H>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full" role="img" aria-label={`Hourly heart rate for ${rows.length} days, ${lo} to ${hi} bpm; darker is higher. Ticks are stimulant doses; labelled rows are when a medicine started.`}>
        {rows.map((r, i) => (
          <g key={r.date}>
            {r.hours.map((v, h) => v === null ? null : <rect key={h} x={L + h * cw} y={i * rh} width={cw - 0.5} height={rh - 0.3} fill={shade(v)} />)}
            {r.doses.map((h, j) => <rect key={`d${j}`} x={L + h * cw - 0.75} y={i * rh} width={1.5} height={rh} fill="var(--text)" opacity={0.75} />)}
            {r.started && <><line x1={L} x2={W - 4} y1={i * rh} y2={i * rh} stroke="var(--primary)" strokeWidth={1} /><circle cx={L - 6} cy={i * rh + rh / 2} r={3} fill="var(--primary)" /></>}
            {i % 14 === 0 && <text x={0} y={i * rh + 8} fontSize={9} fill="var(--muted)">{format(new Date(`${r.date}T12:00`), 'd MMM')}</text>}
          </g>
        ))}
        {[0, 6, 12, 18].map((h) => <text key={h} x={L + h * cw} y={Hh - 4} fontSize={9} fill="var(--muted)">{h === 0 ? '12a' : h === 12 ? '12p' : h === 6 ? '6a' : '6p'}</text>)}
      </svg>
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span className="tnum">{lo}</span><span className="h-2 flex-1 rounded-full" style={{ background: `linear-gradient(90deg, ${shade(lo)}, ${shade(hi)})` }} /><span className="tnum">{hi} bpm</span>
      </div>
      <p className="text-[12px] text-muted">Each row a day, newest at the bottom. Black ticks: stimulant doses. Blue lines: a medicine started.</p>
      {rows.some((r) => r.started) && <p className="text-[12px] text-muted">{rows.filter((r) => r.started).slice(-4).map((r) => `${format(new Date(`${r.date}T12:00`), 'd MMM')}: ${r.started!.join(', ')}`).join(' · ')}</p>}
    </section>
  );
}

// ── 3. Today against your usual ────────────────────────────────────────────────────────────────────

export function TodayUsualCard() {
  const daily = useDaily(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(600_000);
  if (!daily || !fam || !ss) return null;
  const b = todayAgainstUsual(daily.filter((x) => personOf(x) === fam.personId), now, ss[1]);
  if (!b) return null;
  const W = 320, Hh = 140, pad = 22;
  const all = b.flatMap((x) => [x.low, x.high, x.today ?? x.mid]);
  const y0 = Math.min(...all) - 4, y1 = Math.max(...all) + 4;
  const X = (h: number) => pad + (h / 23) * (W - pad - 6), Y = (v: number) => 6 + (1 - (v - y0) / (y1 - y0)) * (Hh - 26);
  const band = `M ${b.map((x) => `${X(x.hour)} ${Y(x.high)}`).join(' L ')} L ${[...b].reverse().map((x) => `${X(x.hour)} ${Y(x.low)}`).join(' L ')} Z`;
  const t = b.filter((x) => x.today !== undefined);
  const above = t.filter((x) => x.today! > x.high);
  return (
    <section className="box space-y-2" aria-labelledby="tu-h">
      <H id="tu-h" Icon={HeartPulse}>Heart rate today, against your usual</H>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="w-full" role="img" aria-label={`Today's heart rate by hour against your usual range.${above.length ? ` Above usual at ${above.map((x) => hh(x.hour)).join(', ')}.` : ' Within your usual range.'}`}>
        <path d={band} fill="var(--primary)" opacity={0.13} />
        <path d={`M ${b.map((x) => `${X(x.hour)} ${Y(x.mid)}`).join(' L ')}`} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 4" />
        {t.length > 1 && <path d={`M ${t.map((x) => `${X(x.hour)} ${Y(x.today!)}`).join(' L ')}`} fill="none" stroke="var(--text)" strokeWidth={2.25} strokeLinejoin="round" />}
        {above.map((x) => <circle key={x.hour} cx={X(x.hour)} cy={Y(x.today!)} r={4} fill="var(--caution)" stroke="var(--surface)" strokeWidth={1.5} />)}
        {[0, 6, 12, 18, 23].map((h) => <text key={h} x={X(h)} y={Hh - 4} fontSize={10} textAnchor="middle" fill="var(--muted)">{h === 0 ? '12a' : h === 12 ? '12p' : h === 6 ? '6a' : h === 18 ? '6p' : '11p'}</text>)}
      </svg>
      <p className="text-[13px] text-muted">Shaded: your usual over the last 4 weeks. Line: today. {above.length ? `Amber: above your usual (${above.length} hour${above.length === 1 ? '' : 's'}).` : 'Within your usual so far.'}</p>
    </section>
  );
}

// ── 4. Dose strips ─────────────────────────────────────────────────────────────────────────────────

export function DoseStripsCard() {
  const meds = useMeds(); const doses = useDoses(); const experiments = useExperiments(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(600_000);
  if (!meds || !doses || !experiments || !fam || !ss || fam.everyone) return null;
  const strips = doseStrips(meds.filter((m) => medIsFor(m, fam.personId)), doses, experiments.filter((e) => personOf(e) === fam.personId), now, ss[1], 42);
  if (!strips.length) return null;
  return (
    <section className="box space-y-3" aria-labelledby="strips-h">
      <H id="strips-h" Icon={CalendarDays}>Last 6 weeks, dose by dose</H>
      <ul className="space-y-2.5">
        {strips.map((st) => {
          const colour = medColour(shownColour(st.med));
          const taken = st.cells.filter((c) => c.state === 'taken').length, planned = st.cells.filter((c) => c.state === 'taken' || c.state === 'missed').length;
          return (
            <li key={st.med.id}>
              <div className="flex items-baseline justify-between text-[13px] mb-1"><span className="font-medium truncate">{shownName(st.med)}</span><span className="text-muted tnum">{taken}/{planned}</span></div>
              <div className="grid gap-[2px]" style={{ gridTemplateColumns: 'repeat(42, minmax(0, 1fr))' }} role="img" aria-label={`${shownName(st.med)}: ${taken} of ${planned} planned days logged in 6 weeks`}>
                {st.cells.map((c, i) => (
                  <span key={c.date} className="relative h-3.5 rounded-[2px]" style={{
                    background: c.state === 'taken' ? colour : c.state === 'break' ? 'repeating-linear-gradient(135deg, var(--fill, #eceff3) 0 2px, transparent 2px 4px)' : c.state === 'none' ? 'var(--fill, #eceff3)' : c.state === 'pre' ? 'transparent' : 'var(--surface)',
                    boxShadow: c.state === 'missed' ? `inset 0 0 0 1.5px ${colour}` : c.state === 'future' ? `inset 0 0 0 1px ${colour}80` : undefined, opacity: c.state === 'none' ? 0.6 : 1,
                    marginLeft: i % 7 === 0 && i ? 2 : 0,
                  }}>{c.offTest && <span className="absolute -bottom-1 left-0 right-0 h-[2px] rounded-full" style={{ background: 'var(--caution)' }} />}</span>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-muted">Filled: logged. Outline: planned, not logged. Grey: not a dose day. Striped: a course break. Amber underline: a test's off day.</p>
    </section>
  );
}

// ── 5. The fridge shelf ────────────────────────────────────────────────────────────────────────────

export function FridgeShelfCard() {
  const meds = useMeds(); const doses = useDoses(); const fam = useFamily();
  const now = useNow(600_000);
  if (!meds || !doses || !fam || fam.everyone) return null;
  const items = fridgeShelf(meds.filter((m) => medIsFor(m, fam.personId)), doses, now);
  if (!items.length) return null;
  return (
    <section className="box space-y-2" aria-labelledby="fridge-h">
      <H id="fridge-h" Icon={Refrigerator}>In the fridge</H>
      <div className="overflow-x-auto -mx-1 px-1">
        <ul className="flex gap-3 items-end min-w-max pb-1">
          {items.map((it) => {
            const colour = medColour(shownColour(it.med));
            const f = it.fill ?? 0;
            return (
              <li key={it.med.id} className="w-[64px] text-center">
                <svg viewBox="0 0 40 70" className="w-10 h-[70px] mx-auto" role="img" aria-label={`${shownName(it.med)}: ${it.fill !== undefined ? `open vial about ${Math.round(f * 100)}% full` : 'none open'}, ${it.unopened} unopened`}>
                  <rect x="12" y="2" width="16" height="8" rx="2" fill="var(--muted)" opacity={0.5} />
                  <rect x="8" y="10" width="24" height="56" rx="6" fill="var(--surface)" stroke="var(--border-strong, #c8ccd2)" strokeWidth="1.5" />
                  {it.fill !== undefined && <rect x="10" y={12 + 52 * (1 - f)} width="20" height={52 * f} rx="4" fill={colour} opacity={0.85} />}
                </svg>
                <p className="text-[12px] font-medium truncate mt-1">{shownName(it.med)}</p>
                <p className="text-[11px] text-muted tnum">{it.fill !== undefined ? `${Math.round(f * 100)}%` : 'none open'} · +{it.unopened}</p>
                {it.mixedAt && <p className="text-[11px] text-muted">mixed {format(Date.parse(it.mixedAt), 'd MMM')}</p>}
              </li>
            );
          })}
        </ul>
      </div>
      <p className="text-[12px] text-muted">The open vial's level, and unopened vials beside it (+).{items.some((x) => x.oldestExpiry) ? ` Oldest expiry: ${items.filter((x) => x.oldestExpiry).map((x) => `${shownName(x.med)} ${format(new Date(`${x.oldestExpiry}T12:00`), 'MMM yyyy')}`).join(', ')}.` : ''}</p>
    </section>
  );
}

// ── 6. The interaction map ─────────────────────────────────────────────────────────────────────────

const LEVEL_COLOUR: Record<Level, string> = { avoid: 'var(--danger, #c62828)', caution: 'var(--caution, #b85c00)', info: 'var(--primary, #2a78d6)' };

export function InteractionMapCard() {
  const meds = useMeds(); const fam = useFamily();
  const [sel, setSel] = useState<string | null>(null);
  if (!meds || !fam) return null;
  const mine = meds.filter((m) => !m.archived && medIsFor(m, fam.personId));
  const pairs = interactions(mine, personOf);
  if (!pairs.length) return null;
  const S = 300, cx = S / 2, cy = S / 2 - 6, R = 112;
  const pos = new Map(mine.map((m, i) => { const a = (i / mine.length) * Math.PI * 2 - Math.PI / 2; return [m.id, [cx + R * Math.cos(a), cy + R * Math.sin(a)] as const]; }));
  const picked = pairs.find((p) => p.key === sel);
  return (
    <section className="box space-y-2" aria-labelledby="imap-h">
      <H id="imap-h" Icon={Network}>How your list fits together</H>
      <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-[320px] mx-auto block" role="img" aria-label={pairs.map((p) => `${shownName(p.a)} and ${shownName(p.b)}: ${p.level}`).join('; ')}>
        {pairs.map((p) => { const [x1, y1] = pos.get(p.a.id)!, [x2, y2] = pos.get(p.b.id)!; return (
          <g key={p.key} onClick={() => setSel(p.key === sel ? null : p.key)} style={{ cursor: 'pointer' }}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={16} />
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={LEVEL_COLOUR[p.level]} strokeWidth={sel === p.key ? 4 : 2.5} opacity={sel && sel !== p.key ? 0.25 : 0.9} strokeDasharray={p.level === 'info' ? '5 4' : undefined} />
          </g>
        ); })}
        {mine.map((m) => { const [x, y] = pos.get(m.id)!; const linked = pairs.some((p) => p.a.id === m.id || p.b.id === m.id); return (
          <g key={m.id}>
            <circle cx={x} cy={y} r={linked ? 13 : 9} fill={medColour(shownColour(m))} stroke="var(--surface)" strokeWidth={3} opacity={linked ? 1 : 0.45} />
            <text x={x} y={y + (y > cy ? 28 : -19)} textAnchor="middle" fontSize={11} fill="var(--text)" fontWeight={linked ? 600 : 400}>{shownName(m).slice(0, 14)}</text>
          </g>
        ); })}
      </svg>
      {picked ? <p className="text-[14px] rounded-btn bg-surface-2 p-2.5"><strong>{shownName(picked.a)} and {shownName(picked.b)}.</strong> {picked.why}.</p>
        : <p className="text-[13px] text-muted text-center">Tap a line for what it means.</p>}
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-muted justify-center">
        <li className="inline-flex items-center gap-1"><span className="w-4 h-[3px]" style={{ background: LEVEL_COLOUR.avoid }} />Labels say not together</li>
        <li className="inline-flex items-center gap-1"><span className="w-4 h-[3px]" style={{ background: LEVEL_COLOUR.caution }} />Worth asking your pharmacist</li>
        <li className="inline-flex items-center gap-1"><span className="w-4 h-[3px]" style={{ background: `repeating-linear-gradient(90deg, ${LEVEL_COLOUR.info} 0 4px, transparent 4px 7px)` }} />Good to know</li>
      </ul>
    </section>
  );
}

// ── 7. The month in review ─────────────────────────────────────────────────────────────────────────

export function MonthRecapCard() {
  const meds = useMeds(); const doses = useDoses(); const body = useBodyEntries(); const daily = useDaily(); const workouts = useWorkouts(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(3_600_000);
  if (!meds || !doses || !body || !daily || !workouts || !fam || !ss || fam.everyone) return null;
  const d = new Date(now); const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(), m = (d.getMonth() + 11) % 12;
  const r = monthRecap({ meds: meds.filter((x) => medIsFor(x, fam.personId)), doses, body: body.filter((x) => personOf(x) === fam.personId), daily: daily.filter((x) => personOf(x) === fam.personId), workouts: workouts.filter((x) => personOf(x) === fam.personId) }, y, m, ss[1]);
  if (!r.doses && !r.weight) return null;
  const cards: { k: string; big: string; small: string; tone: string }[] = [
    ...(r.weight ? [{ k: 'w', big: `${r.weight.end - r.weight.start <= 0 ? '−' : '+'}${Math.abs(Math.round((r.weight.end - r.weight.start) * 10) / 10)} kg`, small: `${r.weight.start} → ${r.weight.end} kg`, tone: 'var(--c-body, #2a78d6)' }] : []),
    ...(r.bodyFat ? [{ k: 'f', big: `${r.bodyFat.start} → ${r.bodyFat.end}%`, small: 'body fat', tone: 'var(--c-pep, #eb6834)' }] : []),
    ...(r.bestSleepWeek ? [{ k: 's', big: `${r.bestSleepWeek.hours} h`, small: `best sleep week, from ${format(r.bestSleepWeek.from, 'd MMM')}`, tone: 'var(--c-sleep, #6250d6)' }] : []),
    ...(r.walks ? [{ k: 'k', big: `${Math.round(r.walkingMin / 6) / 10} h`, small: `walking, ${r.walks} walks`, tone: 'var(--c-heart, #e34948)' }] : []),
    ...(r.streak > 1 ? [{ k: 'st', big: `${r.streak} days`, small: `in a row with every day logged · ${r.doses} doses`, tone: 'var(--c-act, #1baf7a)' }] : []),
    ...(r.started.length ? [{ k: 'n', big: String(r.started.length), small: `started: ${r.started.join(', ')}`, tone: 'var(--c-mind, #8b5cf6)' }] : []),
  ];
  return (
    <section className="box space-y-2" aria-labelledby="recap-h">
      <H id="recap-h" Icon={Sparkles}>{r.month}</H>
      <ul className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory -mx-1 px-1 pb-1">
        {cards.map((c) => (
          <li key={c.k} className="snap-start shrink-0 w-[150px] rounded-card p-3 text-white" style={{ background: c.tone }}>
            <p className="text-[24px] font-bold leading-tight tnum">{c.big}</p>
            <p className="text-[13px] leading-snug opacity-95 mt-1">{c.small}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── 9. What your hardest days had in common ────────────────────────────────────────────────────────

export function HardDaysCard() {
  const meds = useMeds(); const doses = useDoses(); const checkIns = useCheckIns(); const daily = useDaily(); const fam = useFamily(); const ss = useScheduleSettings();
  const now = useNow(3_600_000);
  if (!meds || !doses || !checkIns || !daily || !fam || !ss || fam.everyone) return null;
  const p = roughPattern({ meds: meds.filter((m) => medIsFor(m, fam.personId)), doses, checkIns: checkIns.filter((c) => personOf(c) === fam.personId), daily: daily.filter((x) => personOf(x) === fam.personId) }, now, ss[1]);
  if (!p) return null;
  return (
    <section className="box space-y-2" aria-labelledby="hard-h">
      <H id="hard-h" Icon={Sunrise}>Your hardest days</H>
      <div className="flex items-center gap-3">
        <div className="flex gap-1" aria-hidden="true">{Array.from({ length: p.days }, (_, i) => <span key={i} className="w-3.5 h-8 rounded-full" style={{ background: i < p.of ? 'var(--caution)' : 'var(--fill, #eceff3)' }} />)}</div>
        <p className="text-[15px] flex-1"><strong>{p.of} of your {p.days}</strong> lowest-rated days came with {p.what}.</p>
      </div>
      <p className="text-[12px] text-muted">From your check-ins over the last 2 months, against your other days. Going together, not proof of cause.</p>
    </section>
  );
}
