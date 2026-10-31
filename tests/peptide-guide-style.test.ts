import { describe, it, expect } from 'vitest';
import { GUIDE } from '../src/logic/peptideGuide';

// One voice for every entry: full sentences, the same labels for doses, the same words for the same things.
const DOSE_LABELS = /^(Trials|Label|Russian label|Common use|Starting low|Splitting|Lowest dose): /;
const BANNED = [/\busually\b/i, /\bunapproved\b/i, /\bpurity\b/i, /\bresearch chemical/i, /\bmany people\b/i, /\bsome use\b/i, /\(e\.g\./];

describe('peptide guide style', () => {
  for (const g of GUIDE) {
    it(g.id, () => {
      const lists = { research: g.research, notice: g.notice, doses: g.doses, sideEffects: g.sideEffects, getHelp: g.getHelp, worthKnowing: g.worthKnowing, tips: g.tips, sources: g.sources };
      for (const [k, xs] of Object.entries(lists)) for (const x of xs) expect.soft(x, `${k}: ${x}`).toMatch(/[.)]$/);
      for (const x of [g.what, g.route, g.when, g.cycle ?? '.', g.storage.powder, g.storage.mixed]) expect.soft(x, x).toMatch(/\.$/);
      for (const d of g.doses) expect.soft(d, d).toMatch(DOSE_LABELS);
      expect.soft(g.doses.some((d) => d.startsWith('Common use: ') || d.startsWith('Trials: ') || d.startsWith('Label: ') || d.startsWith('Russian label: ')), 'a dose with a source').toBe(true);
      const all = [g.what, g.route, g.when, g.cycle ?? '', ...Object.values(lists).flat(), g.storage.powder, g.storage.mixed];
      for (const b of BANNED) for (const x of all) expect.soft(x, `${b}: ${x}`).not.toMatch(b);
      expect.soft(g.storage.mixed).toMatch(/^Fridge/);
      expect.soft(g.tableDoses, 'the starting dose is in the table').toContain(g.setup.defaultAmount);
      if (g.steps) expect.soft(g.steps[0].amount).toBe(g.setup.defaultAmount);
      if (g.cycle) expect.soft(g.cycle).toMatch(/^Commonly /);
      expect.soft(g.when, 'when starts with how often').toMatch(/^(Once|Twice|\d–\d times|As needed|Without DAC)/);
      expect.soft(g.storage.powder).toMatch(/^Fridge \(2–8 °C\)/);
      expect.soft(g.route, 'route').toMatch(/(Rotate sites\.|mixed vial\.|BPC-157\.|for the gut\.|Inject slowly\.|by drip\.)$/);
      expect.soft(g.worthKnowing.some((x) => /pregnan/i.test(x)), 'pregnancy').toBe(true);
    });
  }

  it('epitalon: the course adds up', () => {
    const g = GUIDE.find((x) => x.id === 'epitalon')!;
    const c = g.setup.schedule('2026-01-01', 4).course!;
    expect(g.setup.defaultAmount * c.days).toBe(100); // "about 100 mg a course"
    expect(c.remindAfterDays).toBeGreaterThanOrEqual(120); // "repeated every 4–6 months"
    expect(c.remindAfterDays).toBeLessThanOrEqual(180);
    expect(g.doses.join(' ')).toMatch(/10 mg a day for 10 days or 5 mg a day for 20 days/);
    expect(g.cycle).toMatch(/every 4–6 months/);
  });
});
