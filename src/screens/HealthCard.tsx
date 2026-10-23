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
  const [status, setStatus] = useState<{ status: string; granted: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { healthStatus().then(setStatus).catch(() => setStatus({ status: 'unsupported', granted: [] })); }, [on]);
  const name = nativePlatform === 'ios' ? 'Apple Health' : 'Health Connect';
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e) { toast((e as Error).message || `Couldn't reach ${name}.`); } finally { setBusy(false); } };
  const said = (r?: { days: number; weighIns: number; readings: number; workouts?: number }) => r ? `Imported ${r.days} days${r.weighIns ? `, ${r.weighIns} weigh-ins` : ''}${r.readings ? `, ${r.readings} blood pressure readings` : ''}${r.workouts ? `, ${r.workouts} cardio sessions` : ''}.` : '';
  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-medium text-muted flex items-center gap-2"><HeartPulse size={18} aria-hidden="true" /> {name}</h2>
      <p className="text-sm text-muted">Read steps, sleep, heart rate{HAS_BODY ? ', weigh-ins, body fat, runs, walks and rides' : ''} and blood pressure from {name} (read only; nothing is sent anywhere). Used for heart rate after a dose, sleep{HAS_BODY ? ', steps against weight, and readiness on Training' : ''}.</p>
      {status?.status === 'unsupported' && <p className="text-[15px]">Not available on this phone.</p>}
      {status?.status === 'needs-update' && (
        <>
          <p className="text-[15px]">Health Connect needs installing or updating first.</p>
          <Button variant="secondary" onClick={() => MedTapNative.openHealthConnect()}>Get Health Connect</Button>
        </>
      )}
      {status?.status === 'available' && !on && (
        <Button disabled={busy} onClick={() => run(async () => {
          const r = await connectHealth(personId);
          toast(r.granted.length ? said(r.imported) : `Nothing was allowed. You can change that in ${name}.`);
        })}>Connect {name}</Button>
      )}
      {status?.status === 'available' && on && (
        <>
          <p className="text-[15px] tnum">On{personName ? ` for ${personName}` : ''} · {last ? `last import ${fmtAgo(now - Date.parse(last))}` : 'not imported yet'}. Imports again when you open the app, at most every 6 hours.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => run(async () => { toast(said(await importHealth())); })}>Import now</Button>
            <Button variant="secondary" onClick={() => MedTapNative.openHealthConnect()}>{name} settings</Button>
            <Button variant="secondary" onClick={() => run(async () => { await disconnectHealth(); toast('Import is off. Data already imported stays.'); })}>Turn off</Button>
          </div>
        </>
      )}
    </Card>
  );
}
