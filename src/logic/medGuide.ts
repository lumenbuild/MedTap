// The medicine guide: common medicines, each with what it's for, how it's usually taken, what's worth knowing, common
// side effects, when to get help, alcohol and food, and what this app can show from your own records. From product
// information (Australian CMI and PI) and standard references, in plain words. Facts, never instructions: any change to
// a dose or timing is for the prescriber, and the pharmacist knows the person's whole list. Pure.
import type { Medication } from '../db/schema';
import { ingredientsOf } from './ingredients';
import { GUIDE_A } from './medGuideA';
import { GUIDE_B } from './medGuideB';
import { GUIDE_C } from './medGuideC';

export const AREAS = ['ADHD and focus', 'Mood and anxiety', 'Sleep', 'Pain and migraine', 'Weight and diabetes', 'Heart and blood pressure',
  'Stomach and gut', 'Allergy and breathing', 'Infections', 'Hormones, skin and hair', 'Other'] as const;
export type Area = typeof AREAS[number];

export interface GuideMed {
  id: string;
  /** Generic name as shown ("Guanfacine"). */
  name: string;
  /** Active ingredients it covers (lower case, as ingredients.ts names them). */
  generics: string[];
  /** Common brand names, for display ("Intuniv"). */
  brands: string;
  area: Area;
  /** What kind of medicine, in plain words. */
  kind: string;
  /** What it's used for. */
  for: string;
  /** How it's usually taken, from the label. */
  take: string[];
  /** Worth knowing. */
  know: string[];
  /** Common side effects. */
  common: string[];
  /** Get help, or tell the prescriber soon. */
  urgent: string[];
  alcohol?: string;
  food?: string;
  /** What this app can show about it from your own records. */
  app?: string[];
}

export const MED_GUIDE: GuideMed[] = [...GUIDE_A, ...GUIDE_B, ...GUIDE_C];

const byGeneric = new Map<string, GuideMed>();
for (const g of MED_GUIDE) for (const n of g.generics) if (!byGeneric.has(n)) byGeneric.set(n, g);

export const guideMedById = (id: string) => MED_GUIDE.find((g) => g.id === id);

/** The guide entries for a medicine on the person's list, from its ingredients (or its name). */
export function medGuideFor(med: Pick<Medication, 'name' | 'strength' | 'unit' | 'ingredients'>): GuideMed[] {
  const out: GuideMed[] = [];
  for (const i of ingredientsOf(med)) { const g = byGeneric.get(i.name); if (g && !out.includes(g)) out.push(g); }
  // A combined pill's progestogen and oestrogen are the combined pill, not the mini-pill or HRT.
  return out.some((g) => g.id === 'combined-pill') ? out.filter((g) => g.id !== 'mini-pill' && g.id !== 'hrt') : out;
}

/** Search by generic or brand name, or what it's for. */
export function searchGuide(q: string): GuideMed[] {
  const t = q.trim().toLowerCase();
  if (!t) return MED_GUIDE;
  return MED_GUIDE.filter((g) => [g.name, g.brands, g.kind, g.for, ...g.generics].join(' ').toLowerCase().includes(t));
}
