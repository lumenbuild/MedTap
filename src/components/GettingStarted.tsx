// The "Get set up" card on Today (see logic/gettingStarted.ts): each step with a tick when it's been done, tap to go
// and do it, the guide one tap away, and Hide.
import { Check, ChevronRight } from 'lucide-react';
import type { SetupId, SetupItem } from '../logic/gettingStarted';
import { MiniRing } from './ui/Visual';

export function GettingStartedCard({ items, onStep, onHide }: { items: SetupItem[]; onStep: (id: SetupId) => void; onHide: () => void }) {
  const done = items.filter((i) => i.done).length;
  return (
    <section className="border-t border-border pt-4" aria-labelledby="setup-h">
      <div className="flex items-center gap-3">
        <MiniRing value={done} max={items.length} label={`${done} of ${items.length} set-up steps done`} />
        <div className="flex-1">
          <h2 id="setup-h" className="font-semibold">Get set up</h2>
          <p className="text-sm text-muted">{done} of {items.length} done</p>
        </div>
        <button type="button" onClick={onHide} className="min-h-[44px] px-2 -mr-2 text-sm text-muted underline underline-offset-4">Hide</button>
      </div>
      <ul className="mt-2">
        {items.map((i) => (
          <li key={i.id} className="border-t border-border first:border-t-0">
            <button type="button" onClick={() => onStep(i.id)} className="w-full flex items-center gap-3 py-2.5 min-h-[52px] text-left">
              <span aria-hidden="true" className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${i.done ? 'bg-success text-white' : 'border-2 border-border-strong'}`}>
                {i.done && <Check size={14} strokeWidth={3} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className={`block ${i.done ? 'text-muted line-through' : 'font-medium'}`}>{i.label}<span className="sr-only">{i.done ? ', done' : ''}</span></span>
                {!i.done && <span className="block text-sm text-muted">{i.hint}</span>}
              </span>
              {!i.done && <ChevronRight size={18} className="text-muted" aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ul>
      <a href="#/help/start" className="inline-flex items-center min-h-[44px] text-sm font-medium underline underline-offset-4">Getting started guide</a>
    </section>
  );
}
