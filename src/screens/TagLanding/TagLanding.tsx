import { useEffect, useRef, useState } from 'react';
import { isPrivate, shownColour, shownName } from '../../logic/privacy';
import { X } from 'lucide-react';
import type { Dose } from '../../db/schema';
import { db } from '../../db/db';
import { useLive } from '../../db/live';
import { markScanned } from '../../db/repos/tags';
import { removeDose } from '../../db/repos/doses';
import { useDoses, useFamily, useMeds, useScheduleSettings } from '../../app/data';
import { doseOwner, personOf } from '../../db/repos/people';
import { Users } from 'lucide-react';
import { setSetting } from '../../db/repos/settings';
import { PersonBadge } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { useToast } from '../../app/toast';
import { replace } from '../../app/router';
import { fmtAmount, fmtTime } from '../../logic/format';
import { APP_NAME } from '../../config';
import { isAndroid, isNative } from '../../platform';
import { appIntentUrl } from '../../nfc/url';
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
  const fam = useFamily();
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
      {isAndroid && !isNative && id && (
        // The Android app keeps its own data. Older tags open the browser; this hands the tap to the app instead.
        <p className="text-sm text-muted text-center pb-[max(16px,env(safe-area-inset-bottom))]">
          Using the {APP_NAME} Android app? <a className="text-primary font-semibold underline" href={appIntentUrl(id)}>Open in the app</a>
        </p>
      )}
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
  if (tag === undefined || !meds || !doses || !ss || !fam) {
    return shell(<div className="h-[420px] rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />);
  }

  const [, s] = ss;
  const med = tag ? meds.find((m) => m.id === tag.medicationId) : undefined;

  if (!med || reassign) return shell(<UnknownTag id={id} meds={meds.filter((m) => !m.archived)} relinking={!!med} onLinked={() => setReassign(false)}
    personName={fam.many ? (m) => (m.shared ? 'anyone (shared)' : fam.nameOf(personOf(m))) : undefined} />);
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
      // Show the person this dose was for when going back to Today.
      if (fam.many) { setSetting('activePersonId', doseOwner(logged.dose, med)); if (!fam.everyone) setSetting('todayEveryone', false); }
      close();
    };
    const successDoses = med.shared ? doses.filter((d) => d.medicationId !== med.id || personOf(d) === personOf(logged.dose)) : doses;
    return shell(<Success dose={logged.dose} loggedAt={logged.at} med={med} doses={successDoses} s={s} now={now} onUndo={undo} onDone={done} person={fam.many ? fam.nameOf(doseOwner(logged.dose, med)) : undefined} />);
  }

  return shell(
    <Card>
      {fam.many && med.shared && (
        <p className="flex items-center gap-2 mb-4 text-lg font-semibold text-primary"><Users size={24} aria-hidden="true" /> Shared</p>
      )}
      {fam.many && !med.shared && (
        <p className="flex items-center gap-2 mb-4 text-lg font-semibold text-primary" aria-label={`For ${fam.nameOf(personOf(med))}`}>
          <PersonBadge name={fam.nameOf(personOf(med))} size={32} /> For {fam.nameOf(personOf(med))}
        </p>
      )}
      <div className="flex items-center gap-3 mb-5">
        <MedBadge color={shownColour(med)} icon={med.icon} size={48} />
        <div>
          <h1 className="text-2xl font-semibold leading-[30px]">{shownName(med)}</h1>
          {med.strength > 0 && !isPrivate(med) && <p className="text-muted">{fmtAmount(med.strength, med.unit)} {med.form}</p>}
        </div>
      </div>
      <LogDoseFlow med={med} doses={doses} s={s} now={now} tagId={id} people={fam.people} defaultPersonId={null} onLogged={(d) => {
        if (!d.skipped) { setLogged({ dose: d, at: Date.now() }); return; }
        toast(`Marked ${shownName(med)} as skipped`, { onAction: () => removeDose(d.id) });
        close();
      }} onCancel={close} />
    </Card>,
  );
}
