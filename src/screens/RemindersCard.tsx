import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Switch } from '../components/ui/Switch';
import { Button } from '../components/ui/Button';
import { useToast } from '../app/toast';
import { allowExactReminders, exactRemindersAllowed, openBatterySettings, openNotificationSettings, reminderHealth, setRemindersEnabled, syncReminders, testReminder } from '../app/native';
import { setSetting } from '../db/repos/settings';
import { APP_NAME } from '../config';

/** Native app only: phone notifications when doses are due. */
export default function RemindersCard({ enabled, nudges }: { enabled: boolean; nudges: boolean }) {
  const toast = useToast();

  const toggle = async () => {
    const on = await setRemindersEnabled(!enabled);
    if (!enabled && !on) toast(`Notifications are turned off for ${APP_NAME}. Turn them on in your phone’s settings.`);
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-medium text-muted flex items-center gap-2"><BellRing size={18} aria-hidden="true" /> Reminders</h2>
      <Switch label="When doses are due" checked={enabled} onChange={() => toggle()} />
      {enabled && (
        <Switch label="Again if not logged" checked={nudges} onChange={async () => { await setSetting('lateNudges', !nudges); void syncReminders(); }} />
      )}
      {enabled && <ReminderCheck />}
    </Card>
  );
}

/** What can stop or delay reminders on this phone, with a fix for each, and a test reminder. */
function ReminderCheck() {
  const toast = useToast();
  const [h, setH] = useState<Awaited<ReturnType<typeof reminderHealth>> | null>(null);
  const [exact, setExact] = useState(true);
  const [test, setTest] = useState<{ waiting: boolean; lateMs?: number; tapped?: boolean } | null>(null);
  const check = () => { reminderHealth().then(setH).catch(() => setH(null)); exactRemindersAllowed().then(setExact).catch(() => setExact(true)); };
  useEffect(check, []);
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  if (!h) return null;
  // Phones known to stop background alarms unless the app is allowed to run without battery limits.
  const strict = /samsung|xiaomi|redmi|poco|huawei|honor|oppo|realme|oneplus|vivo|motorola|asus|nokia/i.test(h.manufacturer);
  const issues: { text: string; fix?: [string, () => void] }[] = [];
  if (!h.notificationsEnabled || h.channelOff) issues.push({ text: 'Notifications are off for this app, so reminders can’t show.', fix: ['Turn them on', () => { void openNotificationSettings(); }] });
  if (!exact) issues.push({ text: 'Exact timing is off, so reminders may come a few minutes late.', fix: ['Allow exact timing', () => { void allowExactReminders().then(check); }] });
  if (!h.batteryUnrestricted && h.sdk > 0) issues.push({ text: `Battery saving can delay or stop reminders${strict ? ` (${h.manufacturer} phones are known for it)` : ''}.`, fix: ['Let reminders run', () => { void openBatterySettings(); }] });
  return (
    <div className="border-t border-border pt-3 space-y-2">
      <p className="font-medium">Reminder check</p>
      {issues.length === 0 ? <p className="text-sm">Nothing on this phone should stop reminders.</p> : (
        <ul className="space-y-2">
          {issues.map((i) => (
            <li key={i.text} className="text-sm">
              <p>{i.text}</p>
              {i.fix && <button type="button" className="min-h-[44px] font-medium underline underline-offset-4" onClick={i.fix[1]}>{i.fix[0]}</button>}
            </li>
          ))}
        </ul>
      )}
      {!test || !test.waiting ? (
        <Button variant="secondary" onClick={async () => {
          setTest({ waiting: true });
          try { await testReminder((lateMs, tapped) => setTest({ waiting: false, lateMs, tapped })); }
          catch { setTest(null); toast('Couldn’t send a test reminder. Check notifications are on for this app.'); }
        }}>Send a test reminder in 1 minute</Button>
      ) : <p className="text-sm" aria-live="polite">Test reminder coming in a minute. Lock the phone to test it like a real one, then tap it when it arrives.</p>}
      {test && !test.waiting && test.lateMs !== undefined && (
        <p className="text-sm" aria-live="polite">{test.lateMs < 90_000 ? 'It arrived on time.' : `It ${test.tapped ? 'was tapped' : 'arrived'} ${Math.round(test.lateMs / 60_000)} min late${test.tapped ? ' (it may have arrived earlier)' : ''}. ${issues.length ? 'Try the fixes above.' : ''}`}</p>
      )}
    </div>
  );
}
