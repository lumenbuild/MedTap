import { useMemo, useState } from 'react';
import { Lock, Nfc, Pill } from 'lucide-react';
import type { Dose, Medication } from '../../db/schema';
import { useDoses, useMeds, useScheduleSettings } from '../../app/data';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { go } from '../../app/router';
import { byUrgency } from '../../logic/schedule';
import { fmtAmount, fmtMedName, fmtTime } from '../../logic/format';
import { removeDose } from '../../db/repos/doses';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { LogDoseFlow } from '../../components/LogDoseFlow';
import { IOSBanner } from '../../components/IOSBanner';
import { HeroCard } from './HeroCard';
import { PrnCard } from './PrnCard';
import { Timeline } from './Timeline';
import { DoseEditSheet } from './DoseEditSheet';

export function Today() {
  const meds = useMeds();
  const doses = useDoses();
  const ss = useScheduleSettings();
  const now = useNow();
  const toast = useToast();
  const [logFor, setLogFor] = useState<Medication | null>(null);
  const [editing, setEditing] = useState<Dose | null>(null);

  const medMap = useMemo(() => new Map((meds ?? []).map((m) => [m.id, m])), [meds]);

  if (!meds || !doses || !ss) return <TodaySkeleton />;
  const [settings, s] = ss;
  const active = meds.filter((m) => !m.archived);
  // Order is fixed per minute so cards don't reshuffle under the user's thumb every second.
  const scheduled = byUrgency(active.filter((m) => m.schedule.type !== 'prn'), doses, Math.floor(now / 60_000) * 60_000, s);
  const prn = active.filter((m) => m.schedule.type === 'prn');

  const onLogged = (d: Dose) => {
    const med = medMap.get(d.medicationId);
    setLogFor(null);
    toast(`Logged ${fmtAmount(d.amount, med?.unit ?? '')} at ${fmtTime(Date.parse(d.takenAt))}`, {
      onAction: async () => { await removeDose(d.id); toast('Dose removed. Nothing was logged.'); },
    });
  };

  return (
    <div className="space-y-4">
      <IOSBanner dismissed={settings.iosBannerDismissed} />

      {settings.pendingTags.length > 0 && (
        <Card className="flex items-center gap-3">
          <Nfc className="text-primary shrink-0" aria-hidden="true" />
          <p className="flex-1">{settings.pendingTags.length === 1 ? 'A new tag is' : `${settings.pendingTags.length} new tags are`} waiting to be linked.</p>
          <Button variant="secondary" onClick={() => go(`/tag/${settings.pendingTags[0]}`)}>Link</Button>
        </Card>
      )}

      {active.length === 0 && (
        <Card className="text-center py-8">
          <Pill className="mx-auto text-primary" size={32} aria-hidden="true" />
          <p className="mt-3">No medications yet. Add one to start logging doses.</p>
          <Button className="mt-4" onClick={() => go('/meds/new')}>Add medication</Button>
        </Card>
      )}

      {scheduled.length === 1 && (
        <HeroCard med={scheduled[0]} doses={doses} s={s} now={now} onLog={() => setLogFor(scheduled[0])} />
      )}
      {scheduled.length > 1 && (
        <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 no-scrollbar" aria-label="Scheduled medications">
          {scheduled.map((m) => (
            <HeroCard key={m.id} med={m} doses={doses} s={s} now={now} onLog={() => setLogFor(m)}
              className="snap-start shrink-0 w-[calc(100%-28px)]" />
          ))}
        </div>
      )}

      {prn.length > 0 && (
        <section className="space-y-2" aria-label="As needed">
          <h2 className="text-sm font-semibold text-muted px-1">As needed</h2>
          {prn.map((m) => <PrnCard key={m.id} med={m} doses={doses} s={s} now={now} onLog={() => setLogFor(m)} />)}
        </section>
      )}

      {active.length > 0 && <Timeline doses={doses} meds={medMap} s={s} now={now} onEdit={setEditing} />}

      <a href="#/settings" className="flex items-center justify-center gap-2 min-h-[48px] text-sm text-muted">
        <Lock size={16} aria-hidden="true" /> Saved on this device
      </a>

      <Sheet open={!!logFor} onClose={() => setLogFor(null)} title={logFor ? `Log ${fmtMedName(logFor)}` : ''}>
        {logFor && <LogDoseFlow med={logFor} doses={doses} s={s} now={now} onLogged={onLogged} onCancel={() => setLogFor(null)} />}
      </Sheet>
      <DoseEditSheet dose={editing} med={editing ? medMap.get(editing.medicationId) : undefined} onClose={() => setEditing(null)} />
    </div>
  );
}

function TodaySkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-[420px] rounded-card bg-surface-2 animate-pulse" />
      <div className="h-32 rounded-card bg-surface-2 animate-pulse" />
    </div>
  );
}
