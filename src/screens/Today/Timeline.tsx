import { ChevronRight, Nfc, Ruler, Scale, Smile } from 'lucide-react';
import { format } from 'date-fns';
import type { BodyEntry, CheckIn, Dose, Medication } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import { getDayBounds, type ScheduleSettings } from '../../logic/schedule';
import { fmtAmount, fmtTime } from '../../logic/format';
import { fmtWeight, MEASUREMENTS } from '../../logic/units';
import { medColour } from '../../logic/palette';
import { MOOD_LABELS } from '../../components/ui/Rating';
import { Card } from '../../components/ui/Card';

type Item =
  | { kind: 'dose'; at: number; dose: Dose }
  | { kind: 'checkin'; at: number; checkIn: CheckIn }
  | { kind: 'body'; at: number; entry: BodyEntry };

/** Today's doses, check-ins and body entries in time order. Each row opens an editor. */
export function Timeline({ doses, checkIns, body, meds, s, units, now, onDose, onCheckIn, onBody }: {
  doses: Dose[]; checkIns: CheckIn[]; body: BodyEntry[]; meds: Map<string, Medication>; s: ScheduleSettings; units: Units; now: number;
  onDose: (d: Dose) => void; onCheckIn: (c: CheckIn) => void; onBody: (b: BodyEntry) => void;
}) {
  const { start, end } = getDayBounds(now, s.dayStartsAt, s.tz);
  const inDay = (t: number) => t >= start && t < end;
  const today = format(now, 'yyyy-MM-dd');
  const items: Item[] = [
    ...doses.filter((d) => !d.deletedAt && meds.has(d.medicationId) && inDay(Date.parse(d.takenAt))).map((dose) => ({ kind: 'dose' as const, at: Date.parse(dose.takenAt), dose })),
    ...checkIns.filter((c) => !c.deletedAt && inDay(Date.parse(c.at))).map((checkIn) => ({ kind: 'checkin' as const, at: Date.parse(checkIn.at), checkIn })),
    ...body.filter((b) => !b.deletedAt && b.date === today).map((entry) => ({ kind: 'body' as const, at: Date.parse(entry.updatedAt), entry })),
  ].sort((a, b) => a.at - b.at);

  return (
    <Card>
      <h2 className="text-lg font-semibold">Today</h2>
      {items.length === 0 ? (
        <p className="text-muted mt-1">Nothing logged yet today.</p>
      ) : (
        <ol className="mt-2 -mx-2">
          {items.map((it) => {
            let icon, title, sub: string | undefined, onClick, extra = null;
            if (it.kind === 'dose') {
              const med = meds.get(it.dose.medicationId)!;
              icon = <span className="w-2.5 h-2.5 rounded-full shrink-0 mx-[7px]" style={{ background: medColour(med.color) }} aria-hidden="true" />;
              title = <><span className="font-medium">{med.name}</span> <span className="tnum">{fmtAmount(it.dose.amount, med.unit)}</span></>;
              sub = it.dose.source === 'backdated' ? 'Logged later' : undefined;
              extra = it.dose.source === 'tag' ? <Nfc size={16} className="text-muted" aria-label="Logged with a tag" /> : null;
              onClick = () => onDose(it.dose);
            } else if (it.kind === 'checkin') {
              const c = it.checkIn;
              icon = <Smile size={20} className="text-primary shrink-0" aria-hidden="true" />;
              title = <span className="font-medium">Check-in{c.mood ? `: ${MOOD_LABELS[c.mood - 1]}` : ''}</span>;
              sub = [c.energy && `Energy ${c.energy}`, c.focus && `Focus ${c.focus}`, c.chips.length ? c.chips.join(', ') : null].filter(Boolean).join(' · ') || undefined;
              onClick = () => onCheckIn(c);
            } else {
              const b = it.entry;
              const n = MEASUREMENTS.filter((m) => b[m.key] !== undefined).length;
              icon = b.weightKg !== undefined ? <Scale size={20} className="text-primary shrink-0" aria-hidden="true" /> : <Ruler size={20} className="text-primary shrink-0" aria-hidden="true" />;
              title = <span className="font-medium tnum">{[b.weightKg !== undefined ? fmtWeight(b.weightKg, units) : null, n ? `${n} measurement${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</span>;
              onClick = () => onBody(b);
            }
            return (
              <li key={`${it.kind}-${'dose' in it ? it.dose.id : 'checkIn' in it ? it.checkIn.id : it.entry.id}`}>
                <button onClick={onClick} className="w-full min-h-[56px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                  <span className="w-[4.5rem] tnum text-muted shrink-0">{fmtTime(it.at)}</span>
                  {icon}
                  <span className="flex-1 min-w-0">{title}{sub && <span className="block text-xs text-muted truncate">{sub}</span>}</span>
                  {extra}
                  <ChevronRight size={18} className="text-muted" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
