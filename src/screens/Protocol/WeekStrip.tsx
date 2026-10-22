import type { Dose, Medication } from '../../db/schema';
import { weekStrip, type DayState } from '../../logic/protocol';
import type { ScheduleSettings } from '../../logic/schedule';
import { medColour } from '../../logic/palette';
import { shownColour, shownName } from '../../logic/privacy';

const SAY: Record<DayState, string> = {
  taken: 'taken', partial: 'partly taken', missed: 'missed', skipped: 'skipped', today: 'due today', upcoming: 'to come', off: 'no dose', extra: 'extra dose',
};

/** This week, Monday to Sunday, as dots: filled = taken, ring = to come, dashed = missed, faint = no dose that day. */
export function WeekStrip({ med, doses, s, now, label = true }: { med: Medication; doses: Dose[]; s: ScheduleSettings; now: number; label?: boolean }) {
  const days = weekStrip(med, doses, now, s);
  const c = medColour(shownColour(med));
  return (
    <div role="img" aria-label={`${shownName(med)} this week: ${days.map((d) => `${d.label} ${SAY[d.state]}`).join(', ')}`}>
      {label && <p className="text-sm font-medium text-muted mb-2">This week</p>}
      <div className="grid grid-cols-7 gap-1 text-center" aria-hidden="true">
        {days.map((d) => (
          <div key={d.ymd} className="flex flex-col items-center gap-1.5">
            <span className={`text-xs ${d.isToday ? 'text-text font-semibold' : 'text-muted'}`}>{d.label}</span>
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] text-white tnum" style={
              d.state === 'taken' || d.state === 'extra' ? { background: c }
                : d.state === 'partial' ? { background: `linear-gradient(90deg, ${c} 50%, transparent 50%)`, border: `1.5px solid ${c}` }
                  : d.state === 'missed' ? { border: `1.5px dashed ${c}` }
                    : d.state === 'skipped' ? { border: '1.5px solid var(--border-strong)', background: 'var(--surface-2)' }
                      : d.state === 'off' ? { background: 'var(--surface-2)', width: 8, height: 8 }
                        : { border: `1.5px solid ${c}`, ...(d.isToday ? { boxShadow: `0 0 0 3px var(--bg), 0 0 0 4.5px ${c}` } : {}) }}>
              {d.state === 'taken' && d.taken > 1 ? d.taken : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
