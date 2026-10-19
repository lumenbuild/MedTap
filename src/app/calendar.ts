import type { Medication } from '../db/schema';
import { buildIcs } from '../logic/ics';
import { fmtSchedule } from '../logic/format';
import { APP_NAME } from '../config';
import { isIOS } from '../platform';

/** Hand the phone's calendar a one-off event at the next due time, with an alert when it starts. */
export function addToCalendar(med: Medication, start: number) {
  const ics = buildIcs({
    uid: `${crypto.randomUUID()}@medtap`,
    start,
    title: `${med.name}: next dose`,
    description: `Reminder from ${APP_NAME}. Your schedule: ${fmtSchedule(med.schedule, med.unit)}.`,
    now: Date.now(),
  });
  if (isIOS) {
    // Safari opens a calendar event from a data URL straight into "Add to Calendar".
    window.location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    return;
  }
  // Android/desktop: download the .ics; tapping the download opens the calendar app.
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: `${med.name}-reminder.ics` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
