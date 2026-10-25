// Today's ring (how much of today's plan is done), the streaks beside it, the sheet with streaks and milestones, and
// the moment a milestone gets when it's reached.
import { useState } from 'react';
import { format } from 'date-fns';
import { Check, Flame, PartyPopper, Trophy } from 'lucide-react';
import type { Milestone, Ring, Streak } from '../logic/motivation';
import { Sheet } from './ui/Sheet';
import { Button } from './ui/Button';
import { MiniRing } from './ui/Visual';

/** Today's ring and the longest live streak; tap for every streak and the milestones. */
export function DayStrip({ ring, streaks, milestones }: { ring: Ring | null; streaks: Streak[]; milestones: Milestone[] }) {
  const [open, setOpen] = useState(false);
  const top = [...streaks].filter((x) => x.length > 0).sort((a, b) => b.length * (b.unit === 'week' ? 7 : 1) - a.length * (a.unit === 'week' ? 7 : 1))[0];
  if (!ring && !top) return null;
  const all = ring !== null && ring.done === ring.parts.length;
  return (
    <section className="border-t border-border pt-4" aria-label="Your day">
      <button type="button" onClick={() => setOpen(true)} className="w-full flex items-center gap-4 text-left min-h-[64px]">
        {ring && (
          <MiniRing value={Math.round(ring.value * 100)} max={100} size={60} tone={all ? 'good' : 'primary'} label={`${ring.done} of ${ring.parts.length} done today`}>
            {all ? <Check size={22} aria-hidden="true" /> : `${Math.round(ring.value * 100)}%`}
          </MiniRing>
        )}
        <span className="flex-1 min-w-0">
          {ring && <span className="block font-medium">{all ? 'All done for today' : `${ring.done} of ${ring.parts.length} done today`}</span>}
          {ring && <span className="block text-sm text-muted tnum truncate">{ring.parts.map((p) => `${p.label} ${p.got >= p.want ? '✓' : p.text.replace(/^./, (c) => c.toLowerCase())}`).join(' · ')}</span>}
          {top && (
            <span className="flex items-center gap-1.5 text-sm mt-0.5 tnum">
              <Flame size={16} aria-hidden="true" className={top.todayDone ? 'text-caution' : 'text-muted'} />
              {top.length}-{top.unit} streak · {top.label.toLowerCase()}
            </span>
          )}
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Streaks and milestones">
        <div className="space-y-6">
          {ring && (
            <div>
              <h3 className="text-sm font-medium text-muted mb-2">Today</h3>
              <ul className="space-y-1.5">
                {ring.parts.map((p) => (
                  <li key={p.key} className="flex items-center gap-3 min-h-[36px]">
                    <span className={`w-6 h-6 rounded-full flex items-center justify-center ${p.got >= p.want ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'}`}>
                      {p.got >= p.want ? <Check size={14} aria-hidden="true" /> : null}
                    </span>
                    <span className="flex-1">{p.label}</span>
                    <span className="text-muted tnum">{p.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {streaks.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-muted mb-2">Streaks</h3>
              <ul className="space-y-3">
                {streaks.map((x) => (
                  <li key={x.key} className="flex items-center gap-3">
                    <Flame size={20} aria-hidden="true" className={x.length && x.todayDone ? 'text-caution' : 'text-muted'} />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium">{x.label}</span>
                      <span className="block text-sm text-muted tnum">Best {x.best} {x.unit}{x.best === 1 ? '' : 's'}{x.length && !x.todayDone ? ` · ${x.unit === 'day' ? 'today' : 'this week'} still to do` : ''}</span>
                    </span>
                    <span className="text-[22px] font-semibold tnum">{x.length}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted mt-2">Forgiving: one off day in any week doesn't end a daily streak, and one off week in four doesn't end the training one. The doses streak counts only days with doses due (a weekly injection's other days, or a break, don't add to it or end it), and doses skipped on purpose count as on track.</p>
            </div>
          )}
          <div>
            <h3 className="text-sm font-medium text-muted mb-2">Milestones</h3>
            {milestones.length ? (
              <ul className="space-y-2">
                {milestones.slice(0, 30).map((m) => (
                  <li key={m.id} className="flex items-start gap-3">
                    <Trophy size={18} aria-hidden="true" className="text-primary mt-0.5 shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block">{m.title}</span>
                      {m.detail && <span className="block text-sm text-muted">{m.detail}</span>}
                    </span>
                    <span className="text-sm text-muted tnum shrink-0">{format(m.at, 'd MMM')}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[15px] text-muted">None yet. They come with runs of days, workouts, personal bests and steps towards a goal.</p>}
          </div>
        </div>
      </Sheet>
    </section>
  );
}

/** A milestone reached in the last few days that hasn't been seen: a small moment, then it's in the list. */
export function MilestoneCard({ m, more, onDone }: { m: Milestone; more: number; onDone: () => void }) {
  return (
    <section className="rounded-card bg-success-soft p-4 flex items-start gap-3" aria-labelledby="ms-h" role="status">
      <PartyPopper size={28} aria-hidden="true" className="text-success shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <h2 id="ms-h" className="font-semibold text-[17px]">{m.title}</h2>
        {m.detail && <p className="text-[15px] mt-0.5">{m.detail}</p>}
        {more > 0 && <p className="text-sm text-muted mt-0.5">And {more} more this week.</p>}
      </div>
      <Button variant="secondary" onClick={onDone}>Nice</Button>
    </section>
  );
}
