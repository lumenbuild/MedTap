import { SupplementsSection } from '../../components/HowToTake';
import { BookOpen, Calculator, Camera, CalendarClock, CalendarRange, CalendarX, ChevronRight, FileText, Link2, Nfc, Package, Plane, Plus, Wallet, X, type LucideIcon } from 'lucide-react';
import { HAS_PEPTIDES, HAS_VISITS } from '../../edition';

const DAY = 86_400_000;
import { useState, type ReactNode } from 'react';
import { isPrivate, shownColour, shownMedName, shownName } from '../../logic/privacy';
import { format } from 'date-fns';
import type { Medication, Tag } from '../../db/schema';
import { useDoses, useFamily, useMeds, useScheduleSettings, useSettings, useSupplies, useTags } from '../../app/data';
import { supplementsOf } from '../../logic/supplements';
import { DEFAULT_LEAD_DAYS, supplyPlans } from '../../logic/protocol';
import { SUPPLY_LABELS } from '../../logic/peptide';
import { NeedsSheet } from '../Protocol/Predictions';
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
  const [needs, setNeeds] = useState(false);
  const supplies = useSupplies();
  if (!meds || !tags || !settings || !doses || !ss || !fam) return <div className="h-40 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;

  const theirs = meds.filter((m) => medIsFor(m, fam.personId));
  const active = theirs.filter((m) => !m.archived);
  const archived = theirs.filter((m) => m.archived);

  const peptidesOn = HAS_PEPTIDES && settings.peptideTools;
  const isSupp = (m: Medication) => !m.peptide && supplementsOf(m).length > 0;
  const groups: { key: string; title: string; items: Medication[] }[] = [
    { key: 'meds', title: 'Medicines', items: active.filter((m) => !m.peptide && !isSupp(m)) },
    { key: 'peptides', title: 'Peptides', items: active.filter((m) => m.peptide) },
    { key: 'supps', title: 'Supplements', items: active.filter(isSupp) },
  ].filter((g) => g.items.length);
  const s = ss[1];
  // Stock and orders: what runs out or needs ordering in the next 3 weeks, across everything.
  const lead = Math.min(...active.filter((m) => m.peptide).map((m) => m.peptide?.leadTimeDays ?? DEFAULT_LEAD_DAYS), DEFAULT_LEAD_DAYS);
  const orders = [
    ...active.map((m) => {
      const f = forecastRunOut(m, doses, now, s);
      if (!f || f.runOutAt === null || f.runOutAt - now > 21 * DAY) return null;
      const by = m.peptide ? f.runOutAt - (m.peptide.leadTimeDays ?? DEFAULT_LEAD_DAYS) * DAY : f.runOutAt - settings.refillWarnDays * DAY;
      return { key: m.id, name: shownName(m), href: `#/meds/${m.id}/stock`, by, out: f.runOutAt };
    }),
    ...(peptidesOn && supplies ? supplyPlans(supplies, active.filter((m) => m.peptide), doses, now, s, lead).filter((x) => x.orderBy !== null && x.orderBy - now < 21 * DAY && x.supply.kind !== 'sharps')
      .map((x) => ({ key: x.supply.id, name: SUPPLY_LABELS[x.supply.kind].name, href: '#/supplies', by: x.orderBy!, out: x.runOutAt ?? x.orderBy! })) : []),
  ].filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.by - b.by);

  return (
    <div className="space-y-4">
      <PersonSwitcher />
      <div className="grid grid-cols-2 gap-2">
        <Button className="min-h-[52px]" onClick={() => go('/meds/new')}><Plus size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />Add{fam.many ? ` for ${fam.person}` : ''}</Button>
        <Button variant="secondary" className="min-h-[52px]" onClick={() => setCounting(true)}><Camera size={18} aria-hidden="true" className="inline mr-1 -mt-0.5" />Count</Button>
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

      {active.length === 0 && (
        <Card className="text-center py-8">
          <p>{fam.many ? `Nothing for ${fam.person} yet.` : 'Nothing here yet.'} Add a medicine, peptide or supplement: it takes about a minute.</p>
        </Card>
      )}
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`grp-${g.key}`}>
          <h2 id={`grp-${g.key}`} className="text-sm font-medium text-muted mb-2 px-1">{g.title} <span className="tnum">({g.items.length})</span></h2>
          <ul className="box divide-y divide-border" style={{ paddingTop: 0, paddingBottom: 0 }}>{g.items.map((m) => <MedRow key={m.id} med={m} tags={tags} doses={doses} s={s} now={now} />)}</ul>
          {g.key === 'supps' && <SupplementsSection />}
        </section>
      ))}

      {active.length > 0 && (
        <section aria-labelledby="orders-h" className="box space-y-1">
          <h2 id="orders-h" className="text-sm font-medium text-muted">Stock and orders</h2>
          {orders.length ? (
            <ul className="divide-y divide-border">{orders.map((o) => (
              <li key={o.key}><a href={o.href} className="flex items-center gap-3 min-h-[52px]">
                <Package size={18} aria-hidden="true" className={o.by - now < 3 * DAY ? 'text-caution' : 'text-muted'} />
                <span className="flex-1 min-w-0"><span className="block font-medium truncate">{o.name}</span><span className={`block text-sm tnum ${o.by - now < 3 * DAY ? 'text-caution' : 'text-muted'}`}>{o.by <= now ? 'Order now' : `Order by ${format(o.by, 'EEE d MMM')}`} · runs out {format(o.out, 'd MMM')}</span></span>
                <ChevronRight size={18} aria-hidden="true" className="text-muted" />
              </a></li>
            ))}</ul>
          ) : <p className="text-muted">Nothing runs out in the next 3 weeks.</p>}
        </section>
      )}

      <section aria-labelledby="tools-h" className="box">
        <h2 id="tools-h" className="text-sm font-medium text-muted mb-2">Tools</h2>
        <div className="grid grid-cols-3 gap-2">
          {peptidesOn && <Tile Icon={BookOpen} label="Guide" name="Peptide guide" href="#/guide" />}
          {peptidesOn && <Tile Icon={Calculator} label="Calculator" name="Peptide calculator" href="#/calc" />}
          {peptidesOn && <Tile Icon={Package} label="Supplies" href="#/supplies" />}
          {peptidesOn && <Tile Icon={CalendarRange} label="Enough until" name="Enough until: stock for a trip or a date" onClick={() => setNeeds(true)} />}
          <Tile Icon={Nfc} label="Tags" href="#/tags" />
          <Tile Icon={FileText} label="Report" name={peptidesOn ? 'Doctor and protocol reports' : 'Doctor report'} href={peptidesOn ? '#/protocol/report' : '#/report'} />
          {HAS_VISITS && <Tile Icon={Plane} label="Trip" name="Plan a trip: enough for the time away" href="#/travel" />}
        </div>
      </section>

      {counting && <CountPicker meds={active.filter((m) => !m.peptide)} onClose={() => setCounting(false)} />}
      {needs && supplies && <NeedsSheet meds={active} supplies={supplies} doses={doses} s={s} now={now} onClose={() => setNeeds(false)} />}

      {archived.length > 0 && (
        <details className="pt-2">
          <summary className="min-h-[48px] flex items-center text-muted font-semibold cursor-pointer">Archived ({archived.length})</summary>
          <ul className="box divide-y divide-border opacity-80" style={{ paddingTop: 0, paddingBottom: 0 }}>{archived.map((m) => <MedRow key={m.id} med={m} tags={tags} doses={doses} s={s} now={now} />)}</ul>
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
      <a href={`#/meds/${med.id}`} className="py-3.5 flex items-center gap-3">
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
