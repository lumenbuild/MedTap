// "Your caffeine cut-off and limit": from the person's own days, the latest time a drink doesn't cost them sleep and
// the most they have before they feel on edge, with a two-week check to gather the days and buttons to use what's
// found on Today. Patterns in their records, not causes.
import { AlertTriangle, Check } from 'lucide-react';
import { useCheckIns, useDaily, useFamily, useScheduleSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { setSetting } from '../db/repos/settings';
import { personOf } from '../db/repos/people';
import { CHECK_DAYS, caffeineDays, findCutoff, findLimit, intakesOf, type Finding, type FinderBand } from '../logic/caffeine';
import { fmtHHmm } from '../logic/format';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';

const DAY = 86_400_000;
const hourLabel = (h: number) => fmtHHmm(`${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`);

export function CaffeineFinder() {
  const ss = useScheduleSettings();
  const all = useCheckIns();
  const daily = useDaily();
  const fam = useFamily();
  const now = useNow(60_000);
  const toast = useToast();
  if (!ss || !all || !daily || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const [settings, s] = ss;
  const mine = <T extends { personId?: string }>(r: T) => personOf(r) === fam.personId;
  const checkIns = all.filter(mine);
  const days = caffeineDays(intakesOf(checkIns), checkIns, daily.filter(mine), now, s, settings.bedtime, settings.caffeineHalfLifeH);
  const cut = findCutoff(days), lim = findLimit(days);
  const from = settings.caffeineCheckFrom;
  const day = from ? Math.floor((now - from) / DAY) + 1 : 0;
  const running = from !== null && day <= CHECK_DAYS;
  return (
    <div className="space-y-6">
      <p className="text-[15px] text-muted">From your own days: the latest a drink doesn't cost you sleep, and how much you can have before you feel on edge. It needs drinks logged with their times, how you slept, and an evening check-in now and then.</p>

      <Card className="space-y-3">
        <h2 className="font-medium">Two-week caffeine check</h2>
        {running ? (
          <>
            <p className="text-[15px] tnum">Day {Math.min(day, CHECK_DAYS)} of {CHECK_DAYS} · {cut.nights} night{cut.nights === 1 ? '' : 's'} with sleep recorded in the last 60 days</p>
            <ul className="list-disc pl-5 text-[15px] space-y-1">
              <li>Log each drink when you have it (Today → Coffee).</li>
              <li>Each morning Today asks how you slept{settings.healthImport ? ' (hours come from Health Connect)' : ''}.</li>
              <li>In the evening check-in, tick Jittery or Irritable on days you felt on edge.</li>
              <li>It helps to have some days with your last drink early and some later, and some lighter days and some heavier, within what you'd usually have.</li>
            </ul>
            <Button variant="secondary" className="w-full" onClick={() => setSetting('caffeineCheckFrom', null)}>Stop the check</Button>
          </>
        ) : (
          <>
            <p className="text-[15px]">{from ? 'Your check is done; the results below use it. You can run another any time.' : 'For two weeks, Today asks each morning how you slept and keeps count. You can stop any time; the results use whatever days there are.'}</p>
            <Button className="w-full" onClick={() => { void setSetting('caffeineCheckFrom', now); toast('Caffeine check started: day 1 of 14'); }}>{from ? 'Run another check' : 'Start a two-week check'}</Button>
          </>
        )}
      </Card>

      <Result title="Your cut-off" f={cut} metric="sleep"
        found={(v) => <>Nights after a drink from <strong>{hourLabel(v)}</strong> on, you slept worse than after none or only earlier ones.</>}
        clear={(v) => <>No difference so far: nights after a last drink up to {hourLabel(v)} slept about the same as the others.</>}
        apply={cut.status === 'found' && cut.value !== undefined ? {
          label: settings.caffeineCutoff === hhmm(cut.value) ? `Your cut-off is ${hourLabel(cut.value)}` : `Use ${hourLabel(cut.value)} as my cut-off`,
          done: settings.caffeineCutoff === hhmm(cut.value), run: () => setSetting('caffeineCutoff', hhmm(cut.value!)),
        } : undefined} />

      <Result title="Your limit" f={lim} metric="edge"
        found={(v) => <>On days with <strong>{v} mg or more</strong>, you felt on edge more often or slept worse (even with little left at bedtime) than on your lightest days.</>}
        clear={(v) => <>No difference so far: days up to {v} mg felt about the same as your lightest ones.</>}
        apply={lim.status === 'found' && lim.value !== undefined ? {
          label: settings.caffeineLimitMg === lim.value ? `Your limit is ${lim.value} mg` : `Use ${lim.value} mg as my limit`,
          done: settings.caffeineLimitMg === lim.value, run: () => setSetting('caffeineLimitMg', lim.value!),
        } : undefined} />

      <p className="text-xs text-muted">Patterns in your own records over the last 60 days, not causes: sleep and mood change for lots of reasons. Your cut-off and limit are yours to set; they're used on Today and in Trends.</p>
    </div>
  );
}

const hhmm = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:00`;

function Result({ title, f, metric, found, clear, apply }: {
  title: string; f: Finding; metric: 'sleep' | 'edge'; found: (v: number) => React.ReactNode; clear: (v: number) => React.ReactNode;
  apply?: { label: string; done: boolean; run: () => void };
}) {
  return (
    <section className="space-y-3" aria-label={title}>
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      <p className="text-[17px]">
        {f.status === 'found' ? found(f.value!) : f.status === 'clear' ? clear(f.value!)
          : <>Not enough to tell yet ({f.nights} useful day{f.nights === 1 ? '' : 's'}; about 10 are needed, with a few at each end).</>}
      </p>
      <Bands bands={f.bands} metric={metric} />
      {apply && (apply.done
        ? <p className="flex items-center gap-2 text-[15px] text-muted"><Check size={18} aria-hidden="true" /> {apply.label}</p>
        : <Button className="w-full" onClick={apply.run}>{apply.label}</Button>)}
    </section>
  );
}

/** One row per band: the nights in it and the sleep (or how often on edge) as a bar; worse bands marked. */
function Bands({ bands, metric }: { bands: FinderBand[]; metric: 'sleep' | 'edge' }) {
  const hoursMax = Math.max(9, ...bands.map((b) => b.hours ?? 0));
  return (
    <ul className="space-y-2.5">
      {bands.map((b) => {
        const sleep = [b.hours !== undefined ? `${Math.round(b.hours * 10) / 10} h` : null, b.quality !== undefined ? `quality ${Math.round(b.quality * 10) / 10} of 5` : null].filter(Boolean).join(', ') || null;
        const value = metric === 'edge' && b.edgyPct !== undefined ? b.edgyPct / 100 : b.quality !== undefined ? b.quality / 5 : b.hours !== undefined ? b.hours / hoursMax : 0;
        const text = metric === 'edge'
          ? [b.edgyPct !== undefined ? `on edge ${b.edgyPct}% of days` : null, sleep ? `slept ${sleep}` : null].filter(Boolean).join(' · ')
          : sleep ? `slept ${sleep}` : '';
        const thin = b.nights < 3;
        return (
          <li key={b.label} className="space-y-1">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="font-medium flex-1">{b.label}</span>
              <span className="text-muted tnum">{b.nights} {metric === 'sleep' ? 'night' : 'day'}{b.nights === 1 ? '' : 's'}</span>
            </div>
            <div className="h-2.5 rounded-full bg-surface-2 overflow-hidden" role="img" aria-label={`${b.label}: ${thin ? 'too few to compare' : text}${b.worse ? ', worse' : ''}`}>
              {!thin && <div className="h-full rounded-full" style={{ width: `${Math.max(4, value * 100)}%`, background: b.worse ? 'var(--caution)' : 'var(--primary)' }} />}
            </div>
            <p className={`text-xs tnum flex items-center gap-1 ${b.worse ? 'text-caution' : 'text-muted'}`}>
              {b.worse && <AlertTriangle size={12} aria-hidden="true" />}{thin ? 'Too few to compare yet' : text}{b.worse ? ' · worse' : ''}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
