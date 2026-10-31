// Blood tests worth checking for each peptide, why, and the person's latest result for each (matched by name, the
// way labs are printed). Pure.
import type { LabResult } from '../db/schema';
import type { GuideEntry } from './peptideGuide';

interface Test { key: string; label: string; re: RegExp }
const TESTS: Record<string, Test> = {
  hba1c: { key: 'hba1c', label: 'HbA1c', re: /hba1c|a1c|glycated/i },
  glucose: { key: 'glucose', label: 'Fasting glucose', re: /glucose/i },
  lipids: { key: 'lipids', label: 'Cholesterol and triglycerides', re: /\bldl\b|trig|cholesterol/i },
  liver: { key: 'liver', label: 'Liver tests (ALT, GGT)', re: /\balt\b|alanine|\bggt\b|gamma/i },
  kidney: { key: 'kidney', label: 'Kidney function (eGFR)', re: /egfr|creatinine/i },
  lipase: { key: 'lipase', label: 'Lipase', re: /lipase/i },
  igf1: { key: 'igf1', label: 'IGF-1', re: /igf/i },
  copper: { key: 'copper', label: 'Copper and zinc', re: /copper|\bzinc\b|ceruloplasmin/i },
  fbc: { key: 'fbc', label: 'Full blood count', re: /lymph|white cell|\bwbc\b|haemoglobin|hemoglobin/i },
};

const GLP = { tests: ['hba1c', 'lipids', 'liver', 'kidney'], why: 'To see the change in blood sugar, cholesterol and liver fat, and that the kidneys are fine (dehydration from nausea can affect them). Before starting, then every 3–6 months.' };
const GH = { tests: ['igf1', 'glucose', 'hba1c'], why: 'IGF-1 shows how much it’s raising growth hormone; glucose and HbA1c, whether it’s raising blood sugar. Before starting and after 4–8 weeks.' };

/** Guide id → tests and why. */
const BY_ID: Record<string, { tests: string[]; why: string }> = {
  retatrutide: GLP, semaglutide: GLP, tirzepatide: GLP, cagrilintide: GLP,
  ipamorelin: GH, 'cjc-1295': GH, tesamorelin: GH, 'cjc-ipa': GH,
  'mots-c': { tests: ['glucose', 'hba1c'], why: 'It acts on how muscles use glucose: these show whether blood sugar has moved.' },
  'aod-9604': { tests: ['glucose', 'lipids'], why: 'To see whether fat loss shows up in blood sugar and cholesterol.' },
  'ghk-cu': { tests: ['copper'], why: 'It carries copper: worth a check on a long course, or with zinc supplements.' },
  glow: { tests: ['copper'], why: 'The GHK-Cu in it carries copper: worth a check on a long course, or with zinc supplements.' },
  glutathione: { tests: ['liver'], why: 'Often taken for the liver: ALT and GGT show whether anything changes.' },
  'thymosin-alpha-1': { tests: ['fbc'], why: 'It acts on immune cells: a full blood count shows the white cell picture.' },
};

export interface LabCheck { label: string; latest?: LabResult }

/** The tests for this entry and the person's latest result for each. */
export function labsFor(g: GuideEntry, labs: LabResult[]): { why: string; tests: LabCheck[] } | null {
  const m = BY_ID[g.id];
  if (!m) return null;
  const live = labs.filter((l) => !l.deletedAt).sort((a, b) => b.date.localeCompare(a.date));
  return { why: m.why, tests: m.tests.map((k) => ({ label: TESTS[k].label, latest: live.find((l) => TESTS[k].re.test(l.name)) })) };
}
