// The medicine guide (Stack → Tools → Medicines): yours first, then every medicine by what it's for, searchable by
// generic or brand name. Each opens to what to know, side effects, alcohol and food, and how it goes with your list.
import { useState } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { useFamily, useMeds } from '../app/data';
import { medIsFor } from '../db/repos/people';
import { AREAS, MED_GUIDE, guideMedById, medGuideFor, searchGuide, type GuideMed } from '../logic/medGuide';
import { GuideBody, usePairs } from '../components/MedGuide';
import type { Medication } from '../db/schema';

export function MedicineGuide({ id }: { id?: string }) {
  const g = id ? guideMedById(id) : undefined;
  return g ? <GuideMedPage g={g} /> : <GuideMedList />;
}

function useMine(): Map<string, Medication> {
  const meds = useMeds(); const fam = useFamily();
  const out = new Map<string, Medication>();
  for (const m of meds ?? []) if (!m.archived && fam && medIsFor(m, fam.personId)) for (const g of medGuideFor(m)) if (!out.has(g.id)) out.set(g.id, m);
  return out;
}

function GuideMedList() {
  const [q, setQ] = useState('');
  const mine = useMine();
  const list = searchGuide(q);
  const yours = MED_GUIDE.filter((g) => mine.has(g.id));
  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 rounded-btn bg-surface border border-border px-3 min-h-[48px]">
        <Search size={18} aria-hidden="true" className="text-muted" />
        <span className="sr-only">Search medicines</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, brand or what it’s for" className="flex-1 bg-transparent outline-none text-[16px] min-h-[44px]" />
      </label>
      {!q && yours.length > 0 && <Group title="Yours" items={yours} />}
      {AREAS.map((a) => { const items = list.filter((g) => g.area === a); return items.length ? <Group key={a} title={a} items={items} /> : null; })}
      {!list.length && <p className="box text-muted">Nothing called that in the guide yet. A pharmacist can tell you about any medicine.</p>}
      <p className="text-[12px] text-muted px-1">{MED_GUIDE.length} medicines and groups, from product information. Peptides are in their own guide.</p>
    </div>
  );
}

function Group({ title, items }: { title: string; items: GuideMed[] }) {
  return (
    <section className="box" aria-label={title}>
      <h2 className="font-semibold text-[17px] mb-1">{title}</h2>
      <ul className="divide-y divide-border">
        {items.map((g) => (
          <li key={g.id}><a href={`#/medicines/${g.id}`} className="flex items-center gap-3 min-h-[56px] py-2">
            <span className="flex-1 min-w-0"><span className="block font-medium">{g.name}</span><span className="block text-[13px] text-muted truncate">{g.brands}</span></span>
            <ChevronRight size={18} aria-hidden="true" className="text-muted shrink-0" />
          </a></li>
        ))}
      </ul>
    </section>
  );
}

function GuideMedPage({ g }: { g: GuideMed }) {
  const yours = useMine().get(g.id);
  const pairs = usePairs(yours);
  return (
    <div className="space-y-3">
      <section className="hero mind">
        <p className="hero-label">{g.area}</p>
        <h2 className="mt-1 text-[26px] leading-8 font-bold">{g.name}</h2>
        <p className="text-[15px] opacity-90">{g.brands}</p>
        {yours && <a href={`#/meds/${yours.id}`} className="mt-3 inline-flex items-center gap-1 text-[14px] font-semibold underline underline-offset-4">On your list<ChevronRight size={16} aria-hidden="true" /></a>}
      </section>
      <section className="box"><GuideBody g={g} pairs={pairs} open /></section>
    </div>
  );
}
