import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Dose } from '../../db/schema';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { markScanned } from '../../db/repos/tags';
import { removeDose } from '../../db/repos/doses';
import { useDoses, useMeds, useScheduleSettings } from '../../app/data';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { replace } from '../../app/router';
import { fmtAmount, fmtTime } from '../../logic/format';
import { APP_NAME } from '../../config';
import { LogDoseFlow } from '../../components/LogDoseFlow';
import { MedBadge } from '../../components/MedBadge';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Success } from './Success';
import { UnknownTag } from './UnknownTag';
import { ArchivedTag } from './ArchivedTag';

/** Opened by tapping a tag (https://APP_DOMAIN/?t=ID is rewritten to #/tag/ID on boot). */
export function TagLanding({ id }: { id: string }) {
  const tag = useLive(() => db.tags.get(id).then((t) => t ?? null), [id]);
  const meds = useMeds();
  const doses = useDoses();
  const ss = useScheduleSettings();
  const now = useNow();
  const toast = useToast();
  const [logged, setLogged] = useState<{ dose: Dose; at: number } | null>(null);
  const [reassign, setReassign] = useState(false);
  const scanned = useRef(false);

  useEffect(() => {
    if (tag && !scanned.current) { scanned.current = true; markScanned(tag.id); }
  }, [tag]);

  const close = () => replace('/today');
  const shell = (children: React.ReactNode) => (
    <div className="min-h-[100dvh] flex flex-col">
      <header className="flex items-center justify-between h-14">
        <span className="font-semibold text-muted">{APP_NAME}</span>
        <button onClick={close} aria-label="Close" className="w-12 h-12 -mr-3 flex items-center justify-center"><X aria-hidden="true" /></button>
      </header>
      <main className="flex-1 flex flex-col justify-center pb-6">{children}</main>
    </div>
  );

  if (!id) {
    return shell(
      <Card className="text-center">
        <h1 className="text-2xl font-semibold">This link doesn't look right</h1>
        <p className="text-muted mt-2">It doesn't look like a tag from {APP_NAME}. Check the link written on the tag.</p>
        <Button className="w-full mt-5" onClick={close}>Go to Today</Button>
      </Card>,
    );
  }
  if (tag === undefined || !meds || !doses || !ss) {
    return shell(<div className="h-[420px] rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />);
  }

  const [, s] = ss;
  const med = tag ? meds.find((m) => m.id === tag.medicationId) : undefined;

  if (!med || reassign) return shell(<UnknownTag id={id} meds={meds.filter((m) => !m.archived)} relinking={!!med} onLinked={() => setReassign(false)} />);
  if (med.archived) return shell(<ArchivedTag med={med} onReassign={() => setReassign(true)} />);

  if (logged) {
    const undo = async () => {
      await removeDose(logged.dose.id);
      setLogged(null);
      toast('Dose removed. Nothing was logged.');
    };
    const done = () => {
      const left = 10_000 - (Date.now() - logged.at);
      if (left > 0) {
        toast(`Logged ${fmtAmount(logged.dose.amount, med.unit)} at ${fmtTime(Date.parse(logged.dose.takenAt))}`, {
          duration: Math.max(left, 5_000), onAction: () => removeDose(logged.dose.id).then(() => toast('Dose removed. Nothing was logged.')),
        });
      }
      close();
    };
    return shell(<Success dose={logged.dose} loggedAt={logged.at} med={med} doses={doses} s={s} now={now} onUndo={undo} onDone={done} />);
  }

  return shell(
    <Card>
      <div className="flex items-center gap-3 mb-5">
        <MedBadge color={med.color} icon={med.icon} size={48} />
        <div>
          <h1 className="text-2xl font-semibold leading-[30px]">{med.name}</h1>
          {med.strength > 0 && <p className="text-muted">{fmtAmount(med.strength, med.unit)} {med.form}</p>}
        </div>
      </div>
      <LogDoseFlow med={med} doses={doses} s={s} now={now} tagId={id} onLogged={(d) => {
        if (!d.skipped) { setLogged({ dose: d, at: Date.now() }); return; }
        toast(`Marked ${med.name} as skipped`, { onAction: () => removeDose(d.id) });
        close();
      }} onCancel={close} />
    </Card>,
  );
}
