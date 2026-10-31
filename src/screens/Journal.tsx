// The journal (biohacking tools): one line a day, searchable, each beside that day's numbers (sleep, focus, weight,
// doses, brain test).
import { useState } from 'react';
import { format } from 'date-fns';
import { addCheckIn, updateCheckIn } from '../db/repos/checkIns';
import { personOf, storedPerson } from '../db/repos/people';
import { useBodyEntries, useCheckIns, useDaily, useDoses, useFamily, useScheduleSettings } from '../app/data';
import { useToast } from '../app/toast';
import { dayKey } from '../logic/stats';
import { brainScore } from '../logic/biohack';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';

export function Journal() {
  const checkIns = useCheckIns(); const daily = useDaily(); const body = useBodyEntries(); const doses = useDoses(); const fam = useFamily(); const ss = useScheduleSettings();
  const toast = useToast();
  const [line, setLine] = useState('');
  const [q, setQ] = useState('');
  if (!checkIns || !daily || !body || !doses || !fam || !ss) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const s = ss[1];
  const me = <T extends { personId?: string }>(x: T) => personOf(x) === fam.personId;
  const mine = checkIns.filter((c) => me(c) && !c.deletedAt);
  const lines = mine.filter((c) => c.journal && c.note).sort((a, b) => b.at.localeCompare(a.at));
  const todayK = dayKey(Date.now(), s);
  const todays = lines.find((c) => dayKey(Date.parse(c.at), s) === todayK);
  const shown = q.trim() ? lines.filter((c) => c.note!.toLowerCase().includes(q.trim().toLowerCase())) : lines;
  const numbers = (k: string) => {
    const d = daily.find((x) => me(x) && !x.deletedAt && x.date === k);
    const day = mine.filter((c) => dayKey(Date.parse(c.at), s) === k);
    const focus = day.map((c) => c.focus).filter((x): x is number => typeof x === 'number');
    const test = day.map((c) => brainScore(c)).filter((x): x is number => x !== undefined);
    const w = body.find((b) => me(b) && !b.deletedAt && b.date === k && b.weightKg)?.weightKg;
    const n = doses.filter((x) => !x.deletedAt && !x.skipped && dayKey(Date.parse(x.takenAt), s) === k).length;
    return [d?.sleepMin ? `${Math.round(d.sleepMin / 6) / 10} h sleep` : null, focus.length ? `focus ${Math.round((focus.reduce((a, b) => a + b, 0) / focus.length) * 10) / 10}` : null,
      test.length ? `brain ${test[test.length - 1]}` : null, w ? `${w} kg` : null, n ? `${n} dose${n === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
  };
  const save = async () => {
    const text = line.trim();
    if (!text) return;
    if (todays) await updateCheckIn(todays.id, { ...todays, note: text });
    else await addCheckIn({ at: new Date().toISOString(), chips: [], note: text, journal: true, personId: storedPerson(fam.personId) });
    setLine(''); toast('Saved to your journal');
  };
  return (
    <div className="space-y-5 pb-8">
      <section className="space-y-2">
        <TextInput label={todays ? 'Today (replaces this morning’s line)' : 'One line about today'} value={line} onChange={(e) => setLine(e.target.value)} placeholder={todays?.note ?? 'e.g. Sharp all morning, crashed at 4'} maxLength={280} />
        <Button className="w-full min-h-[48px]" onClick={save} disabled={!line.trim()}>Save</Button>
      </section>
      {lines.length > 3 && <TextInput label="Search" type="search" value={q} onChange={(e) => setQ(e.target.value)} />}
      <ul className="divide-y divide-border border-t border-border">
        {shown.map((c) => {
          const k = dayKey(Date.parse(c.at), s);
          return (
            <li key={c.id} className="py-3">
              <p className="text-sm text-muted">{format(new Date(`${k}T12:00`), 'EEE d MMM yyyy')}</p>
              <p className="text-[15px] leading-snug">{c.note}</p>
              {numbers(k) && <p className="text-sm text-muted tnum mt-0.5">{numbers(k)}</p>}
            </li>
          );
        })}
        {!shown.length && <li className="py-3 text-muted">{q ? 'Nothing matches.' : 'No lines yet.'}</li>}
      </ul>
    </div>
  );
}
