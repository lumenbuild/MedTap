import { Plane } from 'lucide-react';
import type { AppSettings } from '../db/repos/settings';
import { setSetting } from '../db/repos/settings';
import { deviceTimeZone } from '../logic/tz';
import { Card } from './ui/Card';
import { Button } from './ui/Button';

/** "Sydney" from "Australia/Sydney". */
export const placeName = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ');

/** Hours between two zones right now, e.g. "+2 h" (positive = ahead of home). */
export function zoneDiff(home: string, here: string, now = Date.now()): string {
  const off = (tz: string) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' })
      .formatToParts(now).reduce<Record<string, number>>((a, x) => (x.type === 'literal' ? a : { ...a, [x.type]: Number(x.value) }), {});
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(now / 60_000) * 60_000;
  };
  const h = (off(here) - off(home)) / 3_600_000;
  if (h === 0) return 'same time';
  return `${h > 0 ? '+' : '−'}${Math.abs(h)} h`;
}

/** Shown while the phone is in a different time zone from home. */
export function TravelBanner({ settings }: { settings: AppSettings }) {
  const here = deviceTimeZone();
  const home = settings.homeTimeZone;
  if (!home || home === here) return null;
  const diff = zoneDiff(home, here);
  const followingPhone = settings.timeMode !== 'home';
  return (
    <Card className="flex gap-3">
      <Plane className="text-primary shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">You're in a different time zone</p>
        <p className="text-sm text-muted">
          {placeName(here)} ({diff} from {placeName(home)}).{' '}
          {followingPhone
            ? 'Set times and your day follow this phone\'s time. Every-few-hours countdowns are unaffected.'
            : `Set times are staying on ${placeName(home)} time and are shown in local time.`}
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="secondary" onClick={() => setSetting('timeMode', followingPhone ? 'home' : 'device')}>
            {followingPhone ? `Keep ${placeName(home)} time` : "Follow this phone's time"}
          </Button>
          <Button variant="secondary" onClick={async () => { await setSetting('homeTimeZone', here); await setSetting('timeMode', 'device'); }}>
            This is home now
          </Button>
        </div>
      </div>
    </Card>
  );
}
