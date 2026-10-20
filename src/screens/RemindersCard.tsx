import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useToast } from '../app/toast';
import { allowExactReminders, exactRemindersAllowed, reminderPermission, setRemindersEnabled, type ReminderPermission } from '../app/native';

/** Native app only: phone notifications when doses are due. */
export default function RemindersCard({ enabled }: { enabled: boolean }) {
  const toast = useToast();
  const [perm, setPerm] = useState<ReminderPermission | null>(null);
  const [exact, setExact] = useState(true);
  const refresh = () => {
    reminderPermission().then(setPerm).catch(() => setPerm('denied'));
    exactRemindersAllowed().then(setExact).catch(() => setExact(true));
  };
  useEffect(refresh, [enabled]);

  const toggle = async () => {
    const on = await setRemindersEnabled(!enabled);
    if (!enabled && !on) toast('Notifications are turned off for MedTap. Turn them on in your phone’s settings.');
    refresh();
  };

  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold flex items-center gap-2"><BellRing size={18} aria-hidden="true" /> Reminders</h2>
      <label className="flex items-center justify-between gap-3 min-h-[48px]">
        <span>
          <span className="block font-medium">Remind me when doses are due</span>
          <span className="block text-sm text-muted">Set times for the next week, and the next dose of every-few-hours medications. From your own schedule.</span>
        </span>
        <input type="checkbox" role="switch" checked={enabled} onChange={toggle} className="w-6 h-6 accent-[var(--primary)] shrink-0" />
      </label>
      {enabled && perm === 'denied' && <p className="text-sm rounded-btn bg-caution-soft p-3">Notifications are turned off for this app in your phone’s settings, so reminders can’t show.</p>}
      {enabled && !exact && (
        <div className="rounded-btn bg-surface-2 p-3 space-y-2">
          <p className="text-sm">Your phone may delay reminders by a few minutes. Allow exact timing to have them on the minute.</p>
          <Button variant="secondary" onClick={async () => { await allowExactReminders(); refresh(); }}>Allow exact timing</Button>
        </div>
      )}
      <p className="text-sm text-muted">Nicknamed medications show their nickname. “Log it” on a reminder logs the planned amount.</p>
    </Card>
  );
}
