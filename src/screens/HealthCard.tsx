import { useEffect, useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useToast } from '../app/toast';
import { connectHealth, disconnectHealth, healthStatus, importHealth } from '../app/health';
import { MedTapNative, nativePlatform } from '../nfc/native';
import { fmtAgo } from '../logic/format';
import { HAS_BODY } from '../edition';

/** Native app only: read steps, sleep and heart rate (and weigh-ins, blood pressure) from Health Connect or Apple Health. */
export default function HealthCard({ on, last, personId, personName, now }: { on: boolean; last: string | null; personId: string; personName?: string; now: number }) {
  const toast = useToast();
  const [status, setStatus] = useState<{ status: string; granted: string[]; asked?: number } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const check = () => healthStatus().then(setStatus).catch(() => setStatus({ status: 'unsupported', granted: [] }));
    void check();
    // Back from Health Connect's settings: show what's allowed now.
    const onVis = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [on]);
  const name = nativePlatform === 'ios' ? 'Apple Health' : 'Health Connect';
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { toast((e as Error).message || `Couldn't reach ${name}.`); } finally { setBusy(false); } };
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  const said = (r?: { days: number; weighIns: number; readings: number; workouts?: number }) => r
    ? `Imported ${n(r.days, 'day', 'days')}${r.weighIns ? `, ${n(r.weighIns, 'weigh-in', 'weigh-ins')}` : ''}${r.readings ? `, ${n(r.readings, 'blood pressure reading', 'blood pressure readings')}` : ''}${r.workouts ? `, ${n(r.workouts, 'workout', 'workouts')}` : ''}.`
    : '';
  const open = () => MedTapNative.openHealthConnect().catch(() => toast(`Couldn't open ${name}. Open it from your phone's Settings.`));
  const refresh = () => healthStatus().then(setStatus).catch(() => undefined);
  const settings = <Button variant="secondary" onClick={open}>{name} settings</Button>;
  const noAccess = status?.status === 'available' && on && nativePlatform !== 'ios' && status.granted.length === 0;
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-medium text-muted flex items-center gap-2"><HeartPulse size={18} aria-hidden="true" /> {name} · read only</h2>
      {status === null && <p className="text-[15px] text-muted">Checking…</p>}
      {status?.status === 'unsupported' && <p className="text-[15px]">Not available on this phone.</p>}
      {status?.status === 'needs-update' && (
        <>
          <p className="text-[15px]">Health Connect needs installing or updating first.</p>
          <Button variant="secondary" onClick={() => { void open(); }}>Get Health Connect</Button>
        </>
      )}
      {status?.status === 'available' && !on && (
        <>
          <p className="text-[15px]">Everything your watch records: sleep, heart rate and HRV, blood oxygen, breathing, skin temperature, steps, calories, workouts{HAS_BODY ? ', weigh-ins' : ''}, blood pressure, and water, food and glucose from other apps. Copied in when you open the app; nothing leaves this phone.</p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => run(async () => {
              const r = await connectHealth(personId);
              toast(r.granted.length ? said(r.imported) : `Nothing was allowed. Use ${name} settings to allow it.`);
              await refresh();
            })}>Connect {name}</Button>
            {settings}
          </div>
        </>
      )}
      {status?.status === 'available' && on && (
        <>
          <p className="text-[15px] tnum">On{personName ? ` for ${personName}` : ''} · {last ? `last import ${fmtAgo(now - Date.parse(last))}` : 'not imported yet'}</p>
          {noAccess && <p className="text-[15px]">Nothing is allowed at the moment, so nothing comes in. Allow it in {name} settings.</p>}
          {!noAccess && status.asked !== undefined && status.granted.length < status.asked && (
            <div className="rounded-btn bg-primary-soft p-3 space-y-2">
              <p className="text-[15px]">More from your watch can come in: blood oxygen, breathing rate, skin temperature, fitness, calories, water and food from other apps, glucose and your full history.</p>
              <Button disabled={busy} onClick={() => run(async () => { const r = await connectHealth(personId); toast(said(r.imported)); await refresh(); })}>Allow more data</Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => run(async () => { toast(said(await importHealth())); })}>Import now</Button>
            {settings}
            <Button variant="secondary" onClick={() => run(async () => { await disconnectHealth(); toast('Import is off. Data already imported stays.'); })}>Turn off</Button>
          </div>
        </>
      )}
    </Card>
  );
}
