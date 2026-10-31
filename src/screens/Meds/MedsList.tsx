import { SupplementsSection } from '../../components/HowToTake';
import { Camera, CalendarClock, CalendarX, ChevronRight, FileText, Link2, Nfc, Package, Plus, Wallet, X, type LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { isPrivate, shownColour, shownMedName, shownName } from '../../logic/privacy';
import { format } from 'date-fns';
import type { Medication, Tag } from '../../db/schema';
import { useDoses, useFamily, useMeds, useScheduleSettings, useSettings, useTags } from '../../app/data';
import { medIsFor, personOf } from '../../db/repos/people';
import { PersonSwitcher } from '../../components/PersonSwitcher';
import { useNow } from '../../app/useNow';
import { forecastRunOut, nextPlannedChange } from '../../logic/plans';
import { dayKey } from '../../logic/stats';
import type { Dose } from '../../db/schema';
import type { ScheduleSettings } from '../../logic/schedule';
import { go } from '../../app/router';
import { fmtSchedule } from '../../logic/format';
import { planLine } from '../../logic/dosePlan';
import { overlaps } from '../../logic/ingredients';
import { interactions } from '../../logic/interactions';
import { Bar, IconRow, Tile } from '../../components/ui/Visual';
import { money, monthlyPackCost } from '../../logic/cost';
import { setSetting } from '../../db/repos/settings';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { MedBadge } from '../../components/MedBadge';
import { CountPicker } from '../../components/CountSheet';

export function MedsList() {
  const meds = useMeds();
  const tags = useTags();
  const settings = useSettings();
  const doses = useDoses();
  const ss = useScheduleSettings();
  const now = useNow(60_000);
  const fam = useFamily();
  const [counting, setCounting] = useState(false);
  if (!meds || !tags || !settings || !doses || !ss || !fam) return <div className="h-40 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;

  const theirs = meds.filter((m) => medIsFor(m, fam.personId));
  const active = theirs.filter((m) => !m.archived);
  const archived = theirs.filter((m) => m.archived);

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="Medication tools">
        <Tile Icon={Plus} label="Add" name={`Add medication${fam.many ? ` for ${fam.person}` : ''}`} href="#/meds/new" />
        <Tile Icon={Camera} label="Count" name="Count what's left, from a photo or typed" onClick={() => setCounting(true)} />
        <Tile Icon={Nfc} label="Tags" href="#/tags" />
        <Tile Icon={FileText} label="Report" name="Doctor report" href="#/report" />
      </div>
      {settings.pendingTags.map((id) => (
        <Card key={id} className="flex items-center gap-3">
          <Nfc className="text-primary shrink-0" aria-hidden="true" />
          <p className="flex-1">A tag you tapped isn't linked yet.</p>
          <Button variant="secondary" onClick={() => go(`/tag/${id}`)}>Link</Button>
        </Card>
      ))}

      {[
        ...overlaps(active, personOf).map((o) => ({ key: o.key, a: o.a, b: o.b, text: o.kind === 'same' ? `both contain ${o.what}` : `both ${o.what}` })),
        ...interactions(active, personOf).map((x) => ({ key: x.key, a: x.a, b: x.b, text: x.why })),
      ].filter((x) => !settings.overlapDismissed.includes(x.key)).map((x) => (
        <IconRow key={x.key} Icon={Link2} tone="plain"
          action={<button type="button" aria-label="Got it" className="w-11 h-11 flex items-center justify-center text-muted" onClick={() => setSetting('overlapDismissed', [...settings.overlapDismissed, x.key])}><X size={20} /></button>}>
          <span className="font-medium">{shownName(x.a)} + {shownName(x.b)}</span>
          <span className="block text-sm text-muted">{x.text}</span>
        </IconRow>
      ))}

      {active.length === 0 ? (
        <Card className="text-center py-8">
          <p>{fam.many ? `No medications for ${fam.person} yet.` : 'No medications yet.'} Adding one takes about a minute.</p>
        </Card>
      ) : (
        <ul className="space-y-2">{active.map((m) => <MedRow key={m.id} med={m} tags={tags} doses={doses} s={ss[1]} now={now} />)}</ul>
      )}


      <SupplementsSection />

      {counting && <CountPicker meds={active.filter((m) => !m.peptide)} onClose={() => setCounting(false)} />}

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
  const f = med.archived ? null : forecastRunOut(med, doses, now, s);
  const days = f && f.runOutAt !== null ? f.daysLeft : undefined;
  const change = med.archived ? undefined : nextPlannedChange(med, dayKey(now, s));
  const low = med.stockCount !== undefined && med.lowStockAt !== undefined && med.stockCount <= med.lowStockAt;
  const cost = monthlyPackCost(med, doses, now);
  const bottle = med.bottles?.[0];
  const bottleSoon = bottle && Date.parse(`${bottle.expiry}T23:59:59`) - now < 30 * 86_400_000;
  return (
    <li>
      <a href={`#/meds/${med.id}`} className="border-t border-border py-3.5 flex items-center gap-3">
        <MedBadge color={shownColour(med)} icon={med.icon} />
        <span className="flex-1 min-w-0 space-y-1">
          <span className="block font-semibold truncate">{shownMedName(med)}{isPrivate(med) && <span className="ml-2 text-xs font-medium text-muted">Nickname</span>}{med.shared && <span className="ml-2 text-xs font-medium text-primary">Shared</span>}</span>
          <span className="block text-sm text-muted">{fmtSchedule(med.schedule, med.unit)}</span>
          {!med.archived && planLine(med, now, s) && <span className="block text-sm tnum">{planLine(med, now, s)}</span>}
          <span className="flex flex-wrap gap-1.5 text-xs tnum">
            <Chip Icon={Nfc} muted={n === 0}>{n === 0 ? 'No tag' : n}</Chip>
            {med.stockCount !== undefined && <Chip Icon={Package} warn={low}>{Math.round(med.stockCount * 100) / 100}{days !== undefined ? ` · ${days} d` : ''}</Chip>}
            {med.repeatsLeft !== undefined && <Chip Icon={FileText} warn={med.repeatsLeft === 0}>{med.repeatsLeft} rpt</Chip>}
            {cost !== undefined && <Chip Icon={Wallet}>{money(cost)}/mo</Chip>}
            {bottle && <Chip Icon={CalendarX} warn={bottleSoon}>{format(new Date(`${bottle.expiry}T12:00`), 'd MMM')}</Chip>}
            {change && <Chip Icon={CalendarClock}>{format(new Date(`${change.from}T12:00`), 'd MMM')}</Chip>}
          </span>
          {days !== undefined && med.stockCount !== undefined && <Bar value={days} max={Math.max(30, days)} tone={days <= 7 ? 'watch' : 'plain'} height={4} label={`${days} days of stock`} />}
        </span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>
    </li>
  );
}

function Chip({ Icon, children, warn, muted }: { Icon: LucideIcon; children: ReactNode; warn?: boolean; muted?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-chip ${warn ? 'bg-caution-soft text-caution font-medium' : 'bg-surface-2'} ${muted ? 'text-muted' : ''}`}>
      <Icon size={12} aria-hidden="true" />{children}
    </span>
  );
}
