// The medicine guide on screen: the same body on a medicine's own page ("What to know") and in the guide (Stack →
// Tools → Medicines). The key points first, the rest a tap away, and the pairs with the person's own medicines.
import { useState } from 'react';
import { AlertTriangle, BookOpen, ChevronDown, ChevronRight, ChevronUp, Info, Link2, Pill, ShieldAlert, Smartphone, Utensils, Wine, type LucideIcon } from 'lucide-react';
import type { Medication } from '../db/schema';
import { useMeds } from '../app/data';
import { personOf } from '../db/repos/people';
import { medGuideFor, type GuideMed } from '../logic/medGuide';
import { interactions, type Level } from '../logic/interactions';
import { shownName } from '../logic/privacy';

const LEVEL: Record<Level, { label: string; Icon: LucideIcon; bg: string; fg: string }> = {
  avoid: { label: 'Labels say not together', Icon: ShieldAlert, bg: 'var(--danger-soft)', fg: 'var(--danger)' },
  caution: { label: 'Worth asking your pharmacist', Icon: AlertTriangle, bg: 'var(--caution-soft)', fg: 'var(--caution)' },
  info: { label: 'Good to know', Icon: Info, bg: 'var(--fill)', fg: 'var(--primary)' },
};

/** Pairs between this medicine and the person's other current medicines. */
export function usePairs(med: Medication | undefined) {
  const meds = useMeds();
  if (!med || !meds) return [];
  return interactions(meds.filter((m) => !m.archived), personOf).filter((x) => x.a.id === med.id || x.b.id === med.id)
    .map((x) => ({ ...x, other: x.a.id === med.id ? x.b : x.a }))
    .sort((a, b) => ['avoid', 'caution', 'info'].indexOf(a.level) - ['avoid', 'caution', 'info'].indexOf(b.level));
}

function Block({ Icon, title, items, tone }: { Icon: LucideIcon; title: string; items: string[]; tone?: 'watch' }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className={`text-[13px] font-semibold flex items-center gap-1.5 mb-1 ${tone === 'watch' ? '' : 'text-muted'}`}>
        <Icon size={15} aria-hidden="true" style={tone === 'watch' ? { color: 'var(--caution)' } : undefined} />{title}
      </h3>
      <ul className="space-y-1 text-[15px] leading-snug list-disc pl-5 marker:text-muted">{items.map((t) => <li key={t}>{t}</li>)}</ul>
    </div>
  );
}

/** One medicine's guide: the key points, then (open) everything else. */
export function GuideBody({ g, pairs = [], open: startOpen = false }: { g: GuideMed; pairs?: ReturnType<typeof usePairs>; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const key = g.know.slice(0, 3);
  return (
    <div className="space-y-3">
      <p className="text-[15px] leading-snug"><span className="font-semibold">{g.kind}.</span> <span className="text-muted">{g.for}</span></p>
      {pairs.length > 0 && (
        <ul className="space-y-1.5" aria-label="With your other medicines">
          {/* The same note for several of your medicines (three stimulants) is said once, naming them all. */}
          {[...new Map(pairs.map((x) => [`${x.level}|${x.why}`, pairs.filter((y) => y.level === x.level && y.why === x.why)])).values()].map((group) => {
            const x = group[0], L = LEVEL[x.level];
            const names = group.map((y) => shownName(y.other));
            return (
              <li key={x.key} className="rounded-btn p-2.5 flex gap-2.5" style={{ background: L.bg }}>
                <L.Icon size={18} aria-hidden="true" className="shrink-0 mt-0.5" style={{ color: L.fg }} />
                <span className="text-[14px] leading-snug"><span className="font-semibold">With {names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}</span> <span className="text-muted">· {L.label}</span><br />{x.why}.</span>
              </li>
            );
          })}
        </ul>
      )}
      <Block Icon={Info} title="Worth knowing" items={open ? g.know : key} />
      {open && (
        <>
          <Block Icon={Pill} title="How it’s usually taken" items={g.take} />
          <Block Icon={Info} title="Common side effects" items={g.common} />
          <Block Icon={AlertTriangle} title="Get help or tell your prescriber soon" items={g.urgent} tone="watch" />
          <Block Icon={Wine} title="Alcohol" items={g.alcohol ? [g.alcohol] : []} />
          <Block Icon={Utensils} title="Food and drink" items={g.food ? [g.food] : []} />
          <Block Icon={Smartphone} title="What this app shows" items={g.app ?? []} />
          <p className="text-[12px] text-muted leading-snug">From product information. Your pharmacist can check your whole list, and any change to a dose or when it’s taken is for your prescriber.</p>
        </>
      )}
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="min-h-[44px] inline-flex items-center gap-1 text-[14px] font-medium text-primary">
        {open ? <>Less <ChevronUp size={16} aria-hidden="true" /></> : <>Side effects, how it’s taken, alcohol and more <ChevronDown size={16} aria-hidden="true" /></>}
      </button>
    </div>
  );
}

/** A medicine's own page: what to know about it, and how it goes with the rest of your list. */
export function MedGuideCard({ med }: { med: Medication }) {
  const pairs = usePairs(med);
  const guides = medGuideFor(med);
  if (!guides.length && !pairs.length) return null;
  return (
    <section className="box space-y-3" aria-labelledby={`know-${med.id}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={`know-${med.id}`} className="font-semibold text-[17px] flex items-center gap-2"><BookOpen size={18} aria-hidden="true" className="text-primary" />What to know</h2>
        {guides[0] && <a href={`#/medicines/${guides[0].id}`} className="min-h-[44px] inline-flex items-center gap-0.5 text-[14px] font-medium text-primary">Guide<ChevronRight size={16} aria-hidden="true" /></a>}
      </div>
      {guides.length ? guides.map((g, i) => (
        <div key={g.id} className={i ? 'pt-3 border-t border-border' : ''}>
          {guides.length > 1 && <p className="font-semibold mb-1">{g.name}</p>}
          <GuideBody g={g} pairs={i === 0 ? pairs : []} />
        </div>
      )) : (
        <ul className="space-y-1.5">{pairs.map((x) => <li key={x.key} className="text-[14px] flex gap-2"><Link2 size={16} aria-hidden="true" className="shrink-0 mt-0.5" /><span><span className="font-semibold">With {shownName(x.other)}:</span> {x.why}</span></li>)}</ul>
      )}
    </section>
  );
}

/** When adding a medicine: the guide has it. */
export function GuideFound({ med }: { med: Pick<Medication, 'name' | 'strength' | 'unit' | 'ingredients'> }) {
  const g = med.name.trim().length >= 3 ? medGuideFor(med)[0] : undefined;
  if (!g) return null;
  return (
    <a href={`#/medicines/${g.id}`} className="flex items-center gap-2.5 rounded-btn bg-primary-soft p-3 min-h-[48px]">
      <BookOpen size={18} aria-hidden="true" className="text-primary shrink-0" />
      <span className="flex-1 min-w-0 text-[14px] leading-snug"><span className="font-semibold">{g.name}</span> is in the medicine guide: what to know, side effects and interactions</span>
      <ChevronRight size={16} aria-hidden="true" className="text-primary shrink-0" />
    </a>
  );
}
