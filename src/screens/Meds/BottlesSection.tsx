import { useState } from 'react';
import { CalendarX2, Trash2 } from 'lucide-react';
import type { Medication } from '../../db/schema';
import { addBottle, removeBottle, restoreBottle } from '../../db/repos/meds';
import { useToast } from '../../app/toast';
import { useNow } from '../../app/useNow';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';
import { fmtBottle } from '../../components/Refill';

const DAY = 86_400_000;

/** Each bottle or pack on hand with its expiry date; Today warns 30 days before. */
export function BottlesSection({ med }: { med: Medication }) {
  const toast = useToast();
  const now = useNow(60_000);
  const [expiry, setExpiry] = useState('');
  const [label, setLabel] = useState('');
  const bottles = med.bottles ?? [];

  const add = async () => {
    if (!expiry) return;
    await addBottle(med.id, { expiry, label });
    setExpiry(''); setLabel('');
    toast('Bottle added');
  };
  const remove = async (id: string) => {
    const b = await removeBottle(med.id, id);
    if (b) toast('Bottle removed', { onAction: () => restoreBottle(med.id, b) });
  };

  return (
    <Card>
      <h2 className="text-sm font-medium text-muted flex items-center gap-2"><CalendarX2 size={20} className="text-primary" aria-hidden="true" /> Bottles and expiry dates</h2>
      {bottles.length === 0
        ? <p className="text-muted mt-1">None added yet.</p>
        : (
          <ul className="mt-2 space-y-2">
            {bottles.map((b) => {
              const t = Date.parse(`${b.expiry}T23:59:59`);
              const tone = t < now ? 'text-danger' : t - now < 30 * DAY ? 'text-caution' : '';
              return (
                <li key={b.id} className="flex items-center gap-3 rounded-btn bg-surface-2 px-3 min-h-[56px]">
                  <span className={`flex-1 tnum font-medium ${tone}`}>{fmtBottle(b, now)}</span>
                  <button onClick={() => remove(b.id)} aria-label={`Remove: ${fmtBottle(b, now)}`} className="w-12 h-12 -mr-2 flex items-center justify-center text-muted">
                    <Trash2 size={20} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      <div className="grid grid-cols-2 gap-3 items-end mt-3">
        <TextInput label="Expiry date" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        <TextInput label="Where it's kept (optional)" placeholder="e.g. School bag" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <Button variant="secondary" className="w-full mt-2" onClick={add} disabled={!expiry}>Add bottle</Button>
    </Card>
  );
}
