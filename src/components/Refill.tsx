import { useState } from 'react';
import { format } from 'date-fns';
import { Package } from 'lucide-react';
import type { Medication } from '../db/schema';
import type { Forecast } from '../logic/plans';
import type { RefillAlert } from '../logic/reminders';
import { restock, unrestock } from '../db/repos/meds';
import { setSetting, type AppSettings } from '../db/repos/settings';
import { useToast } from '../app/toast';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Sheet } from './ui/Sheet';
import { TextInput } from './ui/Field';

const DAY = 86_400_000;

/** "About 6 days left · runs out around Tue 28 Oct" (from your plan) or from recent use for as-needed. */
export function fmtForecast(f: Forecast | null): string | null {
  if (!f) return null;
  if (f.runOutAt === null) return 'More than a year left';
  if (f.daysLeft === 0) return "Not enough left for the rest of today's doses";
  const when = format(f.runOutAt, 'EEE d MMM');
  const days = f.daysLeft === 1 ? '1 day' : `${f.daysLeft} days`;
  return `About ${days} left${f.basis === 'recent-use' ? ' at your recent use' : ''} · runs out around ${when}`;
}

export function fmtScript(med: Medication, now: number): string | null {
  const parts: string[] = [];
  if (med.repeatsLeft !== undefined) parts.push(med.repeatsLeft === 0 ? 'No repeats left' : `${med.repeatsLeft} repeat${med.repeatsLeft === 1 ? '' : 's'} left`);
  if (med.scriptExpiry) {
    const exp = Date.parse(`${med.scriptExpiry}T23:59:59`);
    const d = format(exp, 'd MMM yyyy');
    parts.push(exp < now ? `Script expired ${d}` : exp - now < 30 * DAY ? `Script expires ${d}` : `Script valid to ${d}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

/** Today card: low by your number, running out soon by your plan, or the script needs renewing. */
export function RefillCards({ alerts, settings, now }: { alerts: RefillAlert[]; settings: AppSettings; now: number }) {
  const [restocking, setRestocking] = useState<Medication | null>(null);
  return (
    <>
      {alerts.map(({ med, forecast, low, runningOut, scriptExpiring }) => (
        <Card key={med.id} className="flex gap-3 bg-caution-soft shadow-none">
          <Package className="text-caution shrink-0 mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="tnum"><strong>{med.name}</strong>
              {med.stockCount !== undefined ? `: ${med.stockCount} left.` : '.'}
              {low && !runningOut && med.lowStockAt !== undefined ? ` You asked to know at ${med.lowStockAt}.` : ''}
            </p>
            {(runningOut || low) && fmtForecast(forecast) && <p className="text-sm tnum">{fmtForecast(forecast)}</p>}
            {(scriptExpiring || med.repeatsLeft !== undefined) && fmtScript(med, now) && <p className="text-sm tnum">{fmtScript(med, now)}</p>}
            <div className="flex flex-wrap gap-2 mt-3">
              <Button variant="secondary" onClick={() => setRestocking(med)}>Add stock</Button>
              <Button variant="secondary" onClick={() => setSetting('dismissedLowStock', { ...settings.dismissedLowStock, [med.id]: med.stockCount ?? -1 })}>Dismiss</Button>
            </div>
          </div>
        </Card>
      ))}
      {restocking && <RestockSheet med={restocking} onClose={() => setRestocking(null)} />}
    </>
  );
}

export function RestockSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const [added, setAdded] = useState('');
  const [usedRepeat, setUsedRepeat] = useState(med.repeatsLeft !== undefined && med.repeatsLeft > 0);
  const n = Number(added);
  const valid = added.trim() !== '' && n > 0;
  const what = med.unit === 'tablet' || !med.strength ? `${med.form}s` : `${med.form}s (${med.strength} ${med.unit} each)`;
  const save = async () => {
    if (!valid) return;
    const repeat = usedRepeat && med.repeatsLeft !== undefined && med.repeatsLeft > 0;
    await restock(med.id, n, repeat);
    toast(`Added ${n}. ${med.name} now has ${Math.round(((med.stockCount ?? 0) + n) * 1000) / 1000}.`, { onAction: () => unrestock(med.id, n, repeat) });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Add stock: ${med.name}`}>
      <div className="space-y-4">
        <TextInput label={`How many ${what} did you get?`} type="number" inputMode="decimal" min="0" step="any" value={added}
          onChange={(e) => setAdded(e.target.value)} autoFocus help={med.stockCount !== undefined ? `You have ${med.stockCount} now.` : undefined} />
        {med.repeatsLeft !== undefined && med.repeatsLeft > 0 && (
          <label className="flex items-center gap-3 min-h-[48px]">
            <input type="checkbox" checked={usedRepeat} onChange={(e) => setUsedRepeat(e.target.checked)} className="w-5 h-5 accent-[var(--primary)]" />
            <span>This used a repeat ({med.repeatsLeft} left)</span>
          </label>
        )}
        <Button className="w-full min-h-[56px]" onClick={save} disabled={!valid}>Add to stock</Button>
      </div>
    </Sheet>
  );
}
