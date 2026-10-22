// Plan dose times for a trip across time zones (both apps). Nothing changes until the person changes it: this only shows
// the two usual ways of handling it, with the gaps between doses, so they can choose (with their prescriber's advice).
import { useState } from 'react';
import { format } from 'date-fns';
import { useFamily, useMeds, useSettings } from '../app/data';
import { medIsFor } from '../db/repos/people';
import { deviceTimeZone } from '../logic/tz';
import { travelPlan, type Strategy } from '../logic/travel';
import { shownName } from '../logic/privacy';
import { fmtAmount } from '../logic/format';
import { useNow } from '../app/useNow';
import { TextInput } from '../components/ui/Field';
import { PersonSwitcher } from '../components/PersonSwitcher';

const ZONES: string[] = (() => { try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();
const place = (tz: string) => tz.split('/').pop()!.replace(/_/g, ' ');

export function Travel() {
  const meds = useMeds();
  const settings = useSettings();
  const fam = useFamily();
  const now = useNow(60_000);
  const home = settings?.homeTimeZone ?? deviceTimeZone();
  const [dest, setDest] = useState('Europe/London');
  const [date, setDate] = useState(format(now + 7 * 86_400_000, 'yyyy-MM-dd'));
  if (!meds || !settings || !fam) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const plans = meds.filter((m) => medIsFor(m, fam.personId) && !m.archived).map((m) => travelPlan(m, home, dest, date)).filter(Boolean);
  const interval = meds.filter((m) => medIsFor(m, fam.personId) && !m.archived && m.schedule.type === 'interval');
  return (
    <div className="space-y-2">
      <PersonSwitcher />
      <section className="border-t border-border pt-5 pb-3 space-y-3">
        <p className="text-[15px] text-muted">From home ({place(home)}). This only shows the options: nothing changes. Check the plan with your prescriber or pharmacist before you go.</p>
        <label className="block space-y-1.5">
          <span className="block text-sm font-medium">Going to</span>
          <select value={dest} onChange={(e) => setDest(e.target.value)} className="w-full min-h-[48px] rounded-btn border border-border-strong bg-transparent px-3">
            {ZONES.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <TextInput label="Leaving on" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </section>
      {plans.length === 0 && <p className="border-t border-border pt-5 text-muted">No medicines on set times to plan.</p>}
      {plans.map((p) => (
        <section key={p!.med.id} className="border-t border-border pt-5 pb-3 space-y-3" aria-label={shownName(p!.med)}>
          <h2 className="text-[20px] font-medium">{shownName(p!.med)}</h2>
          {p!.shiftH === 0 ? <p className="text-[15px]">Same time zone: no change.</p> : (
            <>
              <p className="text-[15px] text-muted">{place(dest)} is {Math.abs(p!.shiftH)} hours {p!.shiftH > 0 ? 'ahead' : 'behind'}.</p>
              <Option title="Switch to local time on the day you leave" st={p!.switchNow} unit={p!.med.unit} />
              <Option title="Move 2 hours a day" st={p!.gradual} unit={p!.med.unit} />
            </>
          )}
        </section>
      ))}
      {interval.length > 0 && <p className="border-t border-border pt-4 text-[15px] text-muted">{interval.map(shownName).join(', ')}: every few hours, counted in real hours, so travel doesn't change {interval.length === 1 ? 'it' : 'them'}.</p>}
      <p className="text-sm text-muted pt-2">While away, Settings → When travelling chooses whether set times follow the phone's time zone or home time.</p>
    </div>
  );
}

function Option({ title, st, unit }: { title: string; st: Strategy; unit: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <p className="font-medium">{title}</p>
      <p className={`text-[15px] tnum ${st.flags.length ? 'text-caution' : ''}`}>{st.flags.length ? st.flags.join('; ') : `Gaps stay between ${st.shortest} and ${st.longest} hours.`}</p>
      <button type="button" className="text-sm underline underline-offset-4 min-h-[44px]" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} the times (local)</button>
      {open && <ul className="text-sm tnum">{st.doses.map((d) => <li key={d.at}>{d.local} · {fmtAmount(d.amount, unit)}</li>)}</ul>}
    </div>
  );
}
