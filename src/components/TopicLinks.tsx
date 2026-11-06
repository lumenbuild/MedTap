// "What moves it for you": one tap to each result's own page (where it is, what drives it, what today's plan says).
import { Activity, Brain, HeartPulse, Moon, Scale, Dumbbell, type LucideIcon } from 'lucide-react';

const ALL: { id: string; label: string; Icon: LucideIcon; colour: string; body?: boolean }[] = [
  { id: 'sleep', label: 'Sleep', Icon: Moon, colour: 'var(--c-sleep)' },
  { id: 'rhr', label: 'Resting HR', Icon: HeartPulse, colour: 'var(--c-heart)' },
  { id: 'hrv', label: 'HRV', Icon: Activity, colour: 'var(--c-act)' },
  { id: 'focus', label: 'Focus', Icon: Brain, colour: 'var(--c-mind)' },
  { id: 'weight', label: 'Weight', Icon: Scale, colour: 'var(--c-body)', body: true },
  { id: 'lean', label: 'Lean mass', Icon: Dumbbell, colour: 'var(--c-body)', body: true },
];

export function TopicLinks({ only, body = true, title = 'What moves it for you' }: { only?: string[]; body?: boolean; title?: string }) {
  const items = ALL.filter((x) => (!only || only.includes(x.id)) && (body || !x.body));
  return (
    <section className="box space-y-2" aria-labelledby="topics-h">
      <h2 id="topics-h" className="text-sm font-medium text-muted">{title}</h2>
      <ul className="grid grid-cols-3 gap-2">
        {items.map((x) => (
          <li key={x.id}><a href={`#/topic/${x.id}`} className="flex flex-col items-center gap-1 rounded-btn bg-surface-2 py-2.5 min-h-[64px] text-[13px] font-medium active:scale-[0.97] transition-transform">
            <span aria-hidden="true" className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: x.colour }}><x.Icon size={16} /></span>{x.label}</a></li>
        ))}
      </ul>
    </section>
  );
}
