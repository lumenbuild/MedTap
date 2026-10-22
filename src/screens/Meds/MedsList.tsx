import { ChevronRight, Nfc, Plus } from 'lucide-react';
import { isPrivate, shownColour, shownMedName } from '../../logic/privacy';
import { format } from 'date-fns';
import type { Medication, Tag } from '../../db/schema';
import { useDoses, useFamily, useMeds, useScheduleSettings, useSettings, useTags } from '../../app/data';
import { medIsFor } from '../../db/repos/people';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { forecastRunOut, nextPlannedChange } from '../../logic/plans';
import { dayKey } from '../../logic/stats';
import { fmtBottle, fmtForecast, fmtScript } from '../../components/Refill';
import type { Dose } from '../../db/schema';
import type { ScheduleSettings } from '../../logic/schedule';
import { go } from '../../app/router';
import { fmtSchedule, fmtStock } from '../../logic/format';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MedBadge } from '../../components/MedBadge';

export function MedsList() {
  const meds = useMeds();
  const tags = useTags();
  const settings = useSettings();
  const doses = useDoses();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const fam = useFamily();
  if (!meds || !tags || !settings || !doses || !ss || !fam) return <div className="h-40 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;

  const theirs = meds.filter((m) => medIsFor(m, fam.personId));
  const active = theirs.filter((m) => !m.archived);
  const archived = theirs.filter((m) => m.archived);

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      {settings.pendingTags.map((id) => (
        <Card key={id} className="flex items-center gap-3">
          <Nfc className="text-primary shrink-0" aria-hidden="true" />
          <p className="flex-1">A tag you tapped isn't linked yet.</p>
          <Button variant="secondary" onClick={() => go(`/tag/${id}`)}>Link</Button>
        </Card>
      ))}

      {active.length === 0 ? (
        <Card className="text-center py-8">
          <p>{fam.many ? `No medications for ${fam.person} yet.` : 'No medications yet.'} Adding one takes about a minute.</p>
        </Card>
      ) : (
        <ul className="space-y-2">{active.map((m) => <MedRow key={m.id} med={m} tags={tags} doses={doses} s={ss[1]} now={now} />)}</ul>
      )}

      <Button className="w-full min-h-[56px] flex items-center justify-center gap-2" onClick={() => go('/meds/new')}>
        <Plus size={20} aria-hidden="true" /> Add medication{fam.many ? ` for ${fam.person}` : ''}
      </Button>

      {archived.length > 0 && (
        <details className="pt-2">
          <summary className="min-h-[48px] flex items-center text-muted font-semibold cursor-pointer">Archived ({archived.length})</summary>
          <ul className="space-y-2 opacity-80">{archived.map((m) => <MedRow key={m.id} med={m} tags={tags} doses={doses} s={ss[1]} now={now} />)}</ul>
        </details>
      )}
    </div>
  );
}

function MedRow({ med, tags, doses, s, now }: { med: Medication; tags: Tag[]; doses: Dose[]; s: ScheduleSettings; now: number }) {
  const n = tags.filter((t) => t.medicationId === med.id).length;
  const forecast = med.archived ? null : fmtForecast(forecastRunOut(med, doses, now, s));
  const script = fmtScript(med, now);
  const change = med.archived ? undefined : nextPlannedChange(med, dayKey(now, s));
  const low = med.stockCount !== undefined && med.lowStockAt !== undefined && med.stockCount <= med.lowStockAt;
  return (
    <li>
      <a href={`#/meds/${med.id}`} className="border-t border-border py-4 flex items-center gap-3">
        <MedBadge color={shownColour(med)} icon={med.icon} />
        <span className="flex-1 min-w-0">
          <span className="block font-semibold truncate">{shownMedName(med)}{isPrivate(med) && <span className="ml-2 text-xs font-medium text-muted">Nickname</span>}{med.shared && <span className="ml-2 text-xs font-medium text-primary">Shared</span>}</span>
          <span className="block text-sm text-muted">{fmtSchedule(med.schedule, med.unit)}</span>
          <span className="block text-sm text-muted tnum">
            {n === 0 ? 'No tag yet' : `${n} tag${n === 1 ? '' : 's'} linked`}
            {med.stockCount !== undefined && <> · <span className={low ? 'text-caution font-medium' : ''}>{fmtStock(med)}</span></>}
          </span>
          {forecast && <span className="block text-sm text-muted tnum">{forecast}</span>}
          {script && <span className="block text-sm text-muted tnum">{script}</span>}
          {med.bottles?.[0] && <span className={`block text-sm tnum ${Date.parse(`${med.bottles[0].expiry}T23:59:59`) - now < 30 * 86_400_000 ? 'text-caution font-medium' : 'text-muted'}`}>{fmtBottle(med.bottles[0], now)}</span>}
          {change && <span className="block text-sm text-primary tnum">Change planned from {format(new Date(`${change.from}T12:00`), 'EEE d MMM')}</span>}
        </span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>
    </li>
  );
}
