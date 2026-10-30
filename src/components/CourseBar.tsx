// Where a course is: "Day 9 of 14" with a bar, or on the break, how far through it is until the restart reminder.
import type { Medication } from '../db/schema';
import { courseInfo, getDayBounds, type ScheduleSettings } from '../logic/schedule';

export function courseProgress(med: Medication, now: number, s: ScheduleSettings): { label: string; frac: number; phase: 'on' | 'break' } | null {
  const c = med.schedule.course;
  if (!c || med.archived) return null;
  const i = courseInfo(c, getDayBounds(now, s.dayStartsAt, s.tz).start, s);
  if (i.phase === 'on') return { label: `Day ${i.day} of ${i.length}`, frac: i.day / i.length, phase: 'on' };
  if (i.phase === 'break' && c.remindAfterDays) {
    const left = c.remindAfterDays - i.breakDays;
    return { label: left > 0 ? `Break: ${left >= 14 ? `${Math.round(left / 7)} weeks` : `${left} day${left === 1 ? '' : 's'}`} to go` : 'Break over', frac: Math.min(1, i.breakDays / c.remindAfterDays), phase: 'break' };
  }
  return null;
}

export function CourseBar({ med, now, s, compact = false }: { med: Medication; now: number; s: ScheduleSettings; compact?: boolean }) {
  const p = courseProgress(med, now, s);
  if (!p) return null;
  return (
    <div className={compact ? 'mt-0.5' : 'mt-2'}>
      {!compact && <p className="text-sm tnum">{p.label}</p>}
      <div className={`${compact ? 'h-1' : 'h-1.5 mt-1'} rounded-full bg-surface-2 overflow-hidden`} role="img" aria-label={`Course: ${p.label}`}>
        <div className="h-full rounded-full" style={{ width: `${p.frac * 100}%`, background: p.phase === 'on' ? 'var(--primary)' : 'var(--text-muted)' }} />
      </div>
    </div>
  );
}
