import { repeatRequest } from '../logic/records';
import { useState } from 'react';
import { shownColour, shownMedName, shownName } from '../logic/privacy';
import { format } from 'date-fns';
import { Package, X } from 'lucide-react';
import { Bar } from './ui/Visual';
import type { Bottle, Medication } from '../db/schema';
import { go } from '../app/router';
import type { Forecast } from '../logic/plans';
import type { RefillAlert } from '../logic/reminders';
import { addBottle, restock, unrestock } from '../db/repos/meds';
import { setSetting, type AppSettings } from '../db/repos/settings';
import { useToast } from '../app/toast';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Sheet, SheetActions } from './ui/Sheet';
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

/** "Kitchen bottle expires 12 Nov 2026" / "A bottle expired 2 Oct 2026" */
export function fmtBottle(b: Bottle, now: number): string {
  const exp = Date.parse(`${b.expiry}T23:59:59`);
  const name = b.label ? `${b.label} bottle` : 'A bottle';
  return `${name} ${exp < now ? 'expired' : 'expires'} ${format(exp, 'd MMM yyyy')}`;
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
  // (alerts include low stock, running out by the plan, scripts and bottles expiring)
  const [restocking, setRestocking] = useState<Medication | null>(null);
  return (
    <>
      {alerts.map(({ med, forecast, low, runningOut, scriptExpiring, expiringBottles }) => {
        const days = forecast?.runOutAt === null ? null : forecast?.daysLeft;
        return (
          <Card key={med.id} className="space-y-2">
            <div className="flex items-center gap-3">
              <Package className="shrink-0" style={{ color: shownColour(med) }} aria-hidden="true" />
              <p className="flex-1 min-w-0 font-semibold truncate">{shownName(med)}</p>
              {med.stockCount !== undefined && <p className="tnum"><span className="text-[22px] font-semibold">{Math.round(med.stockCount * 100) / 100}</span> <span className="text-sm text-muted">left</span></p>}
              <button type="button" aria-label="Dismiss" className="w-11 h-11 -mr-2 flex items-center justify-center text-muted"
                onClick={() => setSetting('dismissedLowStock', { ...settings.dismissedLowStock, [med.id]: med.stockCount ?? -1 })}><X size={20} /></button>
            </div>
            {(runningOut || low) && days !== undefined && days !== null && (
              <div className="space-y-1">
                <Bar value={days} max={Math.max(30, days)} tone={days <= 3 ? 'bad' : 'watch'} label={`${days} days left`} />
                <p className="text-sm text-muted tnum">{days} day{days === 1 ? '' : 's'}{forecast?.runOutAt ? ` · out ${format(forecast.runOutAt, 'EEE d MMM')}` : ''}</p>
              </div>
            )}
            {(scriptExpiring || med.repeatsLeft !== undefined) && fmtScript(med, now) && <p className="text-sm tnum">{fmtScript(med, now)}</p>}
            {expiringBottles.map((b) => <p key={b.id} className="text-sm tnum font-medium">{fmtBottle(b, now)}</p>)}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setRestocking(med)}>Add stock</Button>
              {!!med.repeatsLeft && <AskPharmacy meds={[med]} settings={settings} />}
              {expiringBottles.length > 0 && <Button variant="secondary" onClick={() => go(`/meds/${med.id}`)}>Bottles</Button>}
            </div>
          </Card>
        );
      })}
      {restocking && <RestockSheet med={restocking} onClose={() => setRestocking(null)} />}
    </>
  );
}

export function RestockSheet({ med, onClose }: { med: Medication; onClose: () => void }) {
  const toast = useToast();
  const [added, setAdded] = useState('');
  const [usedRepeat, setUsedRepeat] = useState(med.repeatsLeft !== undefined && med.repeatsLeft > 0);
  const [expiry, setExpiry] = useState('');
  const [label, setLabel] = useState('');
  const n = Number(added);
  const valid = added.trim() !== '' && n > 0;
  const what = med.unit === 'tablet' || !med.strength ? `${med.form}s` : `${med.form}s (${med.strength} ${med.unit} each)`;
  const save = async () => {
    if (!valid) return;
    const repeat = usedRepeat && med.repeatsLeft !== undefined && med.repeatsLeft > 0;
    await restock(med.id, n, repeat);
    if (expiry) await addBottle(med.id, { expiry, label });
    toast(`Added ${n}. ${shownName(med)} now has ${Math.round(((med.stockCount ?? 0) + n) * 1000) / 1000}.`, { onAction: () => unrestock(med.id, n, repeat) });
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={`Add stock: ${shownName(med)}`}>
      <div className="space-y-4">
        <TextInput label={`How many ${what} did you get?`} type="number" inputMode="decimal" min="0" step="any" value={added}
          onChange={(e) => setAdded(e.target.value)} autoFocus help={med.stockCount !== undefined ? `You have ${med.stockCount} now.` : undefined} />
        {med.repeatsLeft !== undefined && med.repeatsLeft > 0 && (
          <label className="flex items-center gap-3 min-h-[48px]">
            <input type="checkbox" checked={usedRepeat} onChange={(e) => setUsedRepeat(e.target.checked)} className="w-5 h-5 accent-[var(--primary)]" />
            <span>This used a repeat ({med.repeatsLeft} left)</span>
          </label>
        )}
        <div className="grid grid-cols-2 gap-3 items-start">
          <TextInput label="Expiry date (optional)" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          <TextInput label="Where it's kept (optional)" placeholder="e.g. Kitchen" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={save} disabled={!valid}>Add to stock</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}

/** Send the pharmacy a repeat request: by SMS or email when their contact is set (Settings), else share or copy. */
export function AskPharmacy({ meds, settings, name }: { meds: Medication[]; settings: AppSettings; name?: string }) {
  const toast = useToast();
  const text = repeatRequest(meds, name);
  const c = settings.pharmacyContact.trim();
  const href = /@/.test(c) ? `mailto:${encodeURIComponent(c)}?subject=${encodeURIComponent('Repeat request')}&body=${encodeURIComponent(text)}`
    : /\d{6,}/.test(c.replace(/\D/g, '')) ? `sms:${c.replace(/[^\d+]/g, '')}?body=${encodeURIComponent(text)}` : null;
  if (href) return <a href={href} className="inline-flex items-center min-h-[48px] px-4 rounded-btn border border-border-strong font-semibold">Ask {settings.pharmacyName.trim() || 'the pharmacy'}</a>;
  return (
    <Button variant="secondary" onClick={async () => {
      try { if (navigator.share) { await navigator.share({ text }); return; } } catch { /* cancelled */ }
      try { await navigator.clipboard.writeText(text); toast('Message copied'); } catch { toast(text); }
    }}>Ask the pharmacy</Button>
  );
}

