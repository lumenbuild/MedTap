// A medicine's real start date, on its own page. Most medicines are added the day they're started; one added later
// (after weeks on it) would otherwise have "since starting" begin on the day it was added. Asked for plainly when
// there are records from well before it was added; otherwise one quiet line to change it.
import { useState } from 'react';
import { format } from 'date-fns';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import { strengthCheck } from '../logic/supplements';
import type { Medication } from '../db/schema';
import { setStartedOn } from '../db/repos/meds';
import { useBodyEntries, useDaily, useMeds } from '../app/data';
import { useToast } from '../app/toast';

const ymd = (iso: string) => format(new Date(iso), 'yyyy-MM-dd');
const nice = (d: string) => format(new Date(`${d}T12:00`), 'd MMM yyyy');

export function StartedOnCard({ med }: { med: Medication }) {
  const body = useBodyEntries(); const daily = useDaily(); const meds = useMeds();
  const toast = useToast();
  const added = ymd(med.createdAt);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(med.startedOn ?? added);
  if (!body || !daily || !meds) return null;
  // Asked about the medicines added when the app was first set up (the person was likely already on them), and only
  // when there are records from at least 2 weeks before: then "since starting" may well be wrong. One added later
  // was most likely started that day.
  const earliest = [...body.filter((b) => !b.deletedAt).map((b) => b.date), ...daily.map((d) => d.date)].sort()[0];
  const firstAdded = Math.min(...meds.map((m) => Date.parse(m.createdAt)));
  const atSetUp = Date.parse(med.createdAt) - firstAdded < 7 * 86_400_000;
  const ask = !med.startedOn && atSetUp && earliest !== undefined && Date.parse(`${added}T12:00`) - Date.parse(`${earliest}T12:00`) >= 14 * 86_400_000;
  const save = async () => {
    const v = value && value < added ? value : undefined;
    await setStartedOn(med.id, v);
    setOpen(false);
    toast(v ? `Started ${nice(v)}: comparisons now start there` : 'Started when you added it');
  };
  const editor = (
    <div className="flex items-end gap-2">
      <label className="flex-1 text-[13px] text-muted">Started taking it
        <input type="date" value={value} max={added} onChange={(e) => setValue(e.target.value)} className="mt-1 block w-full min-h-[44px] rounded-btn border border-border bg-surface px-3 text-[16px] text-text" />
      </label>
      <button type="button" onClick={save} className="min-h-[44px] px-4 rounded-btn bg-primary text-on-primary font-semibold">Save</button>
    </div>
  );
  if (ask || open) return (
    <section className="box space-y-2.5" aria-labelledby={`start-${med.id}`}>
      <h2 id={`start-${med.id}`} className="font-semibold text-[17px] flex items-center gap-2"><CalendarClock size={18} aria-hidden="true" className="text-primary" />{ask ? 'When did you start it?' : 'Start date'}</h2>
      {ask && <p className="text-[15px] leading-snug text-muted">You added it on {nice(added)}, and your records go back to {nice(earliest!)}. If you were on it before then, the real date makes “since starting” right.</p>}
      {editor}
    </section>
  );
  return (
    <button type="button" onClick={() => setOpen(true)} className="w-full min-h-[44px] flex items-center gap-2 text-[14px] text-muted px-1">
      <CalendarClock size={16} aria-hidden="true" />Started {nice(med.startedOn ?? added)}<span className="text-primary font-medium ml-auto">Change</span>
    </button>
  );
}

/** A strength that can't be right for what it is (1.2 mg of magnesium), with a way to fix it. */
export function StrengthCheckCard({ med }: { med: Medication }) {
  const c = strengthCheck(med);
  if (!c) return null;
  return (
    <a href={`#/meds/${med.id}/details`} className="flex gap-2.5 rounded-btn p-3 min-h-[48px]" style={{ background: 'var(--caution-soft)' }}>
      <AlertTriangle size={18} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: 'var(--caution)' }} />
      <span className="text-[14px] leading-snug flex-1"><span className="font-semibold">Check the strength. </span>{c.text}</span>
    </a>
  );
}
