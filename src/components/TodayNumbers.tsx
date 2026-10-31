// Today's numbers at a glance, from the watch and weigh-ins: last night's sleep score, HRV against your usual, steps
// towards your target and weight with this week's change. Each in its own colour; tap for the full picture. Only the
// ones with data show.
import { Activity, Footprints, HeartPulse, Moon, Scale, type LucideIcon } from 'lucide-react';
import { useBodyEntries, useCheckIns, useDaily, useFamily, useScheduleSettings } from '../app/data';
import { readiness } from '../logic/training';
import { illnessWatch } from '../logic/vitals';
import { IllnessCard } from './HealthCards';
import { useNow } from '../app/useNow';
import { personOf } from '../db/repos/people';
import { nightsOf, sleepScore, usualNight, fmtHM } from '../logic/sleep';
import { stepsTarget } from '../logic/movement';
import { kgTo } from '../logic/units';
import { HAS_BODY } from '../edition';

const DAY = 86_400_000;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

interface TileData { key: string; label: string; Icon: LucideIcon; color: string; value: string; unit?: string; sub?: React.ReactNode; bar?: number; href: string }

export function TodayNumbers() {
  const daily = useDaily(); const body = useBodyEntries(); const fam = useFamily(); const ss = useScheduleSettings(); const checkIns = useCheckIns();
  const now = useNow(600_000);
  if (!daily || !body || !fam || !ss || !checkIns) return null;
  const [settings, s] = ss;
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === fam.personId;
  const days = daily.filter((d) => !d.deletedAt && me(d));
  const tiles: TileData[] = [];
  // Readiness: last night's recovery from the watch, against your usual.
  const health = settings.healthImport ? '#/health' : '#/training';
  const r = readiness(days, checkIns.filter(me), now, s);
  if (r) tiles.push({ key: 'ready', label: 'Readiness', Icon: Activity, color: 'body', value: String(r.score), unit: r.label.toLowerCase(), bar: r.score / 100, href: health });
  const ill = illnessWatch(days, now, s);

  // Last night, if the watch has it (within the last day and a half).
  const ns = nightsOf(days, now);
  const last = ns[ns.length - 1];
  if (last && now - new Date(`${last.date}T12:00`).getTime() < 1.5 * DAY) {
    const sc = sleepScore(last, settings.sleepTargetH * 60, usualNight(ns, s, last.date), s);
    tiles.push({ key: 'sleep', label: 'Sleep', Icon: Moon, color: 'sleep', value: String(sc.score), unit: 'score', sub: `${fmtHM(last.asleep)}${last.deep ? ` · deep ${fmtHM(last.deep)}` : ''}`, href: settings.sleepTools ? '#/sleep' : '#/progress' });
  }
  // HRV: the latest against the median of the 30 days before it.
  const hrvs = days.filter((d) => d.hrvMs).sort((a, b) => a.date.localeCompare(b.date));
  const h = hrvs[hrvs.length - 1];
  if (h && now - new Date(`${h.date}T12:00`).getTime() < 1.5 * DAY) {
    const prior = hrvs.slice(-31, -1).map((d) => d.hrvMs!);
    const diff = prior.length >= 5 ? Math.round(h.hrvMs! - median(prior)) : undefined;
    tiles.push({ key: 'hrv', label: 'HRV', Icon: HeartPulse, color: 'heart', value: String(Math.round(h.hrvMs!)), unit: 'ms',
      sub: diff === undefined ? 'overnight' : Math.abs(diff) < 2 ? 'about usual' : <span className={diff > 0 ? 'text-success' : 'text-caution'}>{diff > 0 ? '▲' : '▼'} {Math.abs(diff)} vs usual</span>, href: '#/progress' });
  }
  // Steps today, towards the target.
  const today = days.find((d) => d.date === new Date(now).toISOString().slice(0, 10) || new Date(`${d.date}T12:00`).toDateString() === new Date(now).toDateString());
  if (today?.steps) {
    const target = settings.stepsTargetOwn ?? stepsTarget(days, now);
    tiles.push({ key: 'steps', label: 'Steps', Icon: Footprints, color: 'act', value: today.steps.toLocaleString('en-AU'), sub: target ? `of ${target.toLocaleString('en-AU')}` : undefined, bar: target ? Math.min(1, today.steps / target) : undefined, href: '#/progress' });
  }
  // Weight: the latest, and the change from about a week before.
  if (HAS_BODY) {
    const ws = body.filter((b) => !b.deletedAt && me(b) && b.weightKg).sort((a, b) => a.date.localeCompare(b.date));
    const w = ws[ws.length - 1];
    if (w) {
      const weekAgo = new Date(new Date(`${w.date}T12:00`).getTime() - 7 * DAY).toISOString().slice(0, 10);
      const before = [...ws].reverse().find((b) => b.date <= weekAgo);
      const u = settings.units;
      const change = before ? kgTo(w.weightKg!, u) - kgTo(before.weightKg!, u) : undefined;
      tiles.push({ key: 'weight', label: 'Weight', Icon: Scale, color: 'body', value: String(kgTo(w.weightKg!, u)), unit: u === 'imperial' ? 'lb' : 'kg',
        sub: change === undefined || Math.abs(change) < 0.1 ? 'this week: steady' : <span className={change < 0 ? 'text-success' : 'text-muted'}>{change < 0 ? '▼' : '▲'} {Math.abs(Math.round(change * 10) / 10)} this week</span>, href: '#/progress/body' });
    }
  }
  if (!tiles.length && !ill) return null;
  return (
    <>
    {ill && <IllnessCard ill={ill} />}
    <section aria-label="Your numbers" className="grid grid-cols-2 gap-3">
      {tiles.map((t, i) => (
        <a key={t.key} href={t.href} className={`box block min-h-[124px] active:scale-[0.98] transition-transform ${tiles.length % 2 && i === tiles.length - 1 ? 'col-span-2' : ''}`}>
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="w-7 h-7 rounded-[9px] flex items-center justify-center text-white" style={{ background: `var(--c-${t.color})` }}><t.Icon size={16} /></span>
            <span className="text-[15px] font-semibold" style={{ color: `var(--c-${t.color}-ink)` }}>{t.label}</span>
          </span>
          <span className="block mt-3 text-[30px] leading-8 font-bold tracking-[-0.02em] tnum">{t.value}{t.unit && <span className="text-[14px] font-medium text-muted ml-1 tracking-normal">{t.unit}</span>}</span>
          {t.bar !== undefined && <span aria-hidden="true" className="block mt-2.5 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--fill)' }}><span className="block h-full rounded-full" style={{ width: `${t.bar * 100}%`, background: `var(--c-${t.color})` }} /></span>}
          {t.sub && <span className="block mt-1 text-[13px] text-muted tnum">{t.sub}</span>}
        </a>
      ))}
    </section>
    </>
  );
}
