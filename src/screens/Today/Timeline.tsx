import { useState } from 'react';
import { ChevronLeft, ChevronRight, Coffee, HeartPulse, Nfc, Ruler, Scale, Smile } from 'lucide-react';
import { isDrink } from '../../logic/caffeine';
import { fmtVital } from '../../components/VitalsSheet';
import { shownColour, shownName } from '../../logic/privacy';
import { format } from 'date-fns';
import type { BodyEntry, CheckIn, Dose, Medication, Vital } from '../../db/schema';
import type { Units } from '../../db/repos/settings';
import { getDayBounds, type ScheduleSettings } from '../../logic/schedule';
import { fmtAmount, fmtDay, fmtTime } from '../../logic/format';
import { fmtWeight, MEASUREMENTS } from '../../logic/units';
import { medColour } from '../../logic/palette';
import { MOOD_LABELS } from '../../components/ui/Rating';
import { Card } from '../../components/ui/Card';

const DAY = 86_400_000;

type Item =
  | { kind: 'dose'; at: number; dose: Dose }
  | { kind: 'checkin'; at: number; checkIn: CheckIn }
  | { kind: 'body'; at: number; entry: BodyEntry }
  | { kind: 'vital'; at: number; vital: Vital };

/** A day's doses, check-ins and body entries in time order (today, or an earlier day with the arrows). Each row opens
 *  an editor, so a dose from last week can be fixed or removed too. */
export function Timeline({ doses, checkIns, body, vitals, meds, s, units, now, onDose, onCheckIn, onBody, onVital, personLabel }: {
  doses: Dose[]; checkIns: CheckIn[]; body: BodyEntry[]; vitals: Vital[]; meds: Map<string, Medication>; s: ScheduleSettings; units: Units; now: number;
  onDose: (d: Dose) => void; onCheckIn: (c: CheckIn) => void; onBody: (b: BodyEntry) => void; onVital: (v: Vital) => void;
  /** In the Everyone view, whose entry each row is. */
  personLabel?: (r: { personId?: string }) => string | undefined;
}) {
  const [back, setBack] = useState(0);
  const todayStart = getDayBounds(now, s.dayStartsAt, s.tz).start;
  // Midday of the day shown (days start at "Day starts at", so step from the start of today).
  const ref = back === 0 ? now : todayStart - back * DAY + DAY / 2;
  const { start, end } = getDayBounds(ref, s.dayStartsAt, s.tz);
  const inDay = (t: number) => t >= start && t < end;
  const today = format(ref, 'yyyy-MM-dd');
  const first = Math.min(...doses.map((d) => Date.parse(d.takenAt)), ...checkIns.map((c) => Date.parse(c.at)), now);
  const oldest = Math.max(0, Math.ceil((todayStart - first) / DAY));
  const label = back === 0 ? 'today' : back === 1 ? 'yesterday' : `on ${fmtDay(ref, now)}`;
  const items: Item[] = [
    ...doses.filter((d) => !d.deletedAt && meds.has(d.medicationId) && inDay(Date.parse(d.takenAt))).map((dose) => ({ kind: 'dose' as const, at: Date.parse(dose.takenAt), dose })),
    ...checkIns.filter((c) => !c.deletedAt && inDay(Date.parse(c.at))).map((checkIn) => ({ kind: 'checkin' as const, at: Date.parse(checkIn.at), checkIn })),
    ...body.filter((b) => !b.deletedAt && b.date === today).map((entry) => ({ kind: 'body' as const, at: Date.parse(entry.updatedAt), entry })),
    ...vitals.filter((v) => !v.deletedAt && inDay(Date.parse(v.at))).map((vital) => ({ kind: 'vital' as const, at: Date.parse(vital.at), vital })),
  ].sort((a, b) => a.at - b.at);

  return (
    <Card>
      <div className="flex items-center gap-1 -my-2">
        <h2 className="flex-1 text-sm font-medium text-muted" aria-live="polite">Logged {label}</h2>
        <button type="button" aria-label="Day before" disabled={back >= oldest} onClick={() => setBack(back + 1)}
          className="w-11 h-11 flex items-center justify-center text-muted disabled:opacity-30"><ChevronLeft size={20} aria-hidden="true" /></button>
        <button type="button" aria-label="Day after" disabled={back === 0} onClick={() => setBack(back - 1)}
          className="w-11 h-11 -mr-3 flex items-center justify-center text-muted disabled:opacity-30"><ChevronRight size={20} aria-hidden="true" /></button>
      </div>
      {items.length === 0 ? (
        <p className="text-muted mt-1">{back === 0 ? 'Nothing logged yet today.' : `Nothing logged ${label}.`}</p>
      ) : (
        <ol className="mt-2 -mx-2">
          {items.map((it) => {
            let icon, title, sub: string | undefined, onClick, extra = null;
            if (it.kind === 'dose') {
              const med = meds.get(it.dose.medicationId)!;
              icon = <span className="w-2.5 h-2.5 rounded-full shrink-0 mx-[7px]" aria-hidden="true"
                style={it.dose.skipped ? { border: `2px solid ${medColour(shownColour(med))}` } : { background: medColour(shownColour(med)) }} />;
              title = it.dose.skipped
                ? <><span className="font-medium">{shownName(med)}</span> <span className="text-muted">skipped</span></>
                : <><span className="font-medium">{shownName(med)}</span> <span className="tnum">{fmtAmount(it.dose.amount, med.unit)}</span></>;
              sub = it.dose.skipped ? it.dose.skipReason : it.dose.source === 'backdated' ? 'Logged later' : it.dose.source === 'reminder' ? 'From a reminder' : undefined;
              extra = it.dose.source === 'tag' ? <Nfc size={16} className="text-muted" aria-label="Logged with a tag" /> : null;
              onClick = () => onDose(it.dose);
              // Shared medications: label with who took this dose.
              if (personLabel) sub = [personLabel(med.shared ? it.dose : med), sub].filter(Boolean).join(' · ');
            } else if (it.kind === 'checkin' && isDrink(it.checkIn)) {
              const c = it.checkIn;
              icon = <Coffee size={20} className="text-primary shrink-0" aria-hidden="true" />;
              title = <><span className="font-medium">{c.note ?? 'Caffeine'}</span>{c.caffeineMg !== undefined && <span className="tnum"> {c.caffeineMg} mg</span>}</>;
              onClick = () => onCheckIn(c);
              if (personLabel) sub = personLabel(c);
            } else if (it.kind === 'checkin') {
              const c = it.checkIn;
              icon = <Smile size={20} className="text-primary shrink-0" aria-hidden="true" />;
              title = <span className="font-medium">Check-in{c.mood ? `: ${MOOD_LABELS[c.mood - 1]}` : ''}</span>;
              sub = [c.energy && `Energy ${c.energy}`, c.focus && `Focus ${c.focus}`, c.chips.length ? c.chips.join(', ') : null].filter(Boolean).join(' · ') || undefined;
              onClick = () => onCheckIn(c);
              if (personLabel) sub = [personLabel(c), sub].filter(Boolean).join(' · ');
            } else if (it.kind === 'vital') {
              icon = <HeartPulse size={20} className="text-primary shrink-0" aria-hidden="true" />;
              title = <span className="font-medium tnum">{fmtVital(it.vital)}</span>;
              onClick = () => onVital(it.vital);
              if (personLabel) sub = personLabel(it.vital);
            } else {
              const b = it.entry;
              const n = MEASUREMENTS.filter((m) => b[m.key] !== undefined).length;
              icon = b.weightKg !== undefined ? <Scale size={20} className="text-primary shrink-0" aria-hidden="true" /> : <Ruler size={20} className="text-primary shrink-0" aria-hidden="true" />;
              title = <span className="font-medium tnum">{[b.weightKg !== undefined ? fmtWeight(b.weightKg, units) : null, n ? `${n} measurement${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}</span>;
              onClick = () => onBody(b);
              if (personLabel) sub = personLabel(b);
            }
            return (
              <li key={`${it.kind}-${'dose' in it ? it.dose.id : 'checkIn' in it ? it.checkIn.id : 'vital' in it ? it.vital.id : it.entry.id}`}>
                <button onClick={onClick} className="w-full min-h-[56px] flex items-center gap-3 px-2 rounded-btn text-left hover:bg-surface-2">
                  <span className="w-[4.5rem] whitespace-nowrap tnum text-muted shrink-0">{fmtTime(it.at)}</span>
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
