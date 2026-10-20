import { useState } from 'react';
import { Package } from 'lucide-react';
import type { Supply, SupplyKind } from '../db/schema';
import { setSupply, stopTracking, updateSupply } from '../db/repos/supplies';
import { useDoses, useMeds, useSupplies } from '../app/data';
import { useToast } from '../app/toast';
import { SUPPLY_LABELS, supplyCount } from '../logic/peptide';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { TextInput } from '../components/ui/Field';
import { APP_NAME } from '../config';

const KINDS: SupplyKind[] = ['syringes', 'pen-needles', 'swabs', 'water', 'sharps'];
const HELP: Record<SupplyKind, string> = {
  syringes: 'One used for each dose from a vial.',
  'pen-needles': 'One used for each dose from a pen.',
  swabs: 'One used for each injection.',
  water: 'Used when you mix a vial (the water you enter).',
  sharps: 'Fills by one for each injection. Today reminds you when it is nearly full.',
};

/** Injection supplies: counted down automatically from the doses logged and vials mixed. */
export function Supplies() {
  const supplies = useSupplies();
  const meds = useMeds();
  const doses = useDoses();
  const [editing, setEditing] = useState<SupplyKind | null>(null);
  if (!supplies || !meds || !doses) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const byKind = new Map(supplies.filter((x) => !x.deletedAt).map((x) => [x.kind, x]));
  return (
    <div className="space-y-4">
      <p className="text-muted px-1">Enter what you have once; {APP_NAME} counts down as you log injections and mix vials.</p>
      {KINDS.map((k) => {
        const sup = byKind.get(k);
        const count = sup ? supplyCount(sup, meds, doses) : null;
        const { name, unit } = SUPPLY_LABELS[k];
        const low = sup && count !== null && (k === 'sharps' ? sup.capacity !== undefined && count >= (sup.warnAt ?? Math.floor(sup.capacity * 0.8)) : sup.warnAt !== undefined && count <= sup.warnAt);
        return (
          <Card key={k} className="flex items-center gap-3">
            <Package className={low ? 'text-caution' : 'text-primary'} aria-hidden="true" />
            <div className="flex-1">
              <p className="font-semibold">{name}</p>
              <p className={`text-sm tnum ${low ? 'text-caution font-medium' : 'text-muted'}`}>
                {count === null ? 'Not tracked' : k === 'sharps' ? `${count}${sup?.capacity ? ` of ${sup.capacity}` : ''} in it` : `${count}${unit ? ` ${unit}` : ''} left`}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setEditing(k)}>{sup ? 'Update' : 'Track'}</Button>
          </Card>
        );
      })}
      {editing && <SupplySheet kind={editing} sup={byKind.get(editing)} count={byKind.get(editing) ? supplyCount(byKind.get(editing)!, meds, doses) : undefined} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupplySheet({ kind, sup, count, onClose }: { kind: SupplyKind; sup?: Supply; count?: number; onClose: () => void }) {
  const toast = useToast();
  const sharps = kind === 'sharps';
  const { name, unit } = SUPPLY_LABELS[kind];
  const [n, setN] = useState(count !== undefined ? String(count) : sharps ? '0' : '');
  const [cap, setCap] = useState(sup?.capacity !== undefined ? String(sup.capacity) : '');
  const [warn, setWarn] = useState(sup?.warnAt !== undefined ? String(sup.warnAt) : '');
  const opt = (s: string) => (s.trim() === '' ? undefined : Number(s));
  const valid = Number(n) >= 0 && n.trim() !== '' && (!sharps || Number(cap) >= 1);
  const save = async () => {
    const extra = { capacity: sharps ? opt(cap) : undefined, warnAt: opt(warn) };
    if (count !== undefined && Number(n) === count) await updateSupply(kind, extra);
    else await setSupply(kind, Number(n), extra);
    toast(`${name} saved`);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={name}>
      <div className="space-y-4">
        <p className="text-sm text-muted">{HELP[kind]}</p>
        <TextInput label={sharps ? 'How many are in it now' : `How many you have now${unit ? ` (${unit})` : ''}`} type="number" inputMode="decimal" min="0" step="any" value={n} onChange={(e) => setN(e.target.value)} />
        {sharps && (
          <>
            <TextInput label="How many it holds" type="number" inputMode="numeric" min="1" step="1" value={cap} onChange={(e) => setCap(e.target.value)} />
            <Button variant="secondary" className="w-full" onClick={() => setN('0')}>I've started a new container</Button>
          </>
        )}
        <TextInput label={sharps ? 'Remind me when it has (optional)' : 'Remind me when it is down to (optional)'} help={sharps ? 'Leave blank for 80% full.' : undefined}
          type="number" inputMode="decimal" min="0" step="any" value={warn} onChange={(e) => setWarn(e.target.value)} />
        <Button className="w-full min-h-[56px]" disabled={!valid} onClick={save}>Save</Button>
        {sup && <Button variant="secondary" className="w-full" onClick={async () => { await stopTracking(kind); onClose(); }}>Stop tracking</Button>}
      </div>
    </Sheet>
  );
}

/** Today: supplies running low, or the sharps container nearly full. */
export function SupplyAlerts({ alerts }: { alerts: { supply: Supply; count: number }[] }) {
  if (!alerts.length) return null;
  return (
    <Card className="bg-caution-soft shadow-none flex gap-3">
      <Package className="text-caution shrink-0 mt-0.5" aria-hidden="true" />
      <div className="flex-1 space-y-2">
        {alerts.map(({ supply, count }) => (
          <p key={supply.kind}>
            <strong>{SUPPLY_LABELS[supply.kind].name}:</strong>{' '}
            {supply.kind === 'sharps' ? `${count}${supply.capacity ? ` of ${supply.capacity}` : ''} in it. Time for a new one soon.` : `${count}${SUPPLY_LABELS[supply.kind].unit ? ` ${SUPPLY_LABELS[supply.kind].unit}` : ''} left.`}
          </p>
        ))}
        <a href="#/supplies" className="inline-block min-h-[44px] leading-[44px] text-primary font-semibold">Supplies</a>
      </div>
    </Card>
  );
}
