import { describe, it, expect } from 'vitest';
import type { Medication } from '../src/db/schema';
import { MED_GUIDE, medGuideFor, searchGuide, AREAS } from '../src/logic/medGuide';
import { MED_NAMES } from '../src/logic/medNames';
import { interactions } from '../src/logic/interactions';

const med = (id: string, name: string, extra: Partial<Medication> = {}): Medication => ({ id, name, strength: 1, unit: 'mg', form: 'tablet', defaultAmount: 1,
  schedule: { type: 'fixed', slots: [{ time: '08:00' }] }, color: '', icon: 'pill', archived: false, createdAt: '', updatedAt: '', ...extra });

describe('medicine guide', () => {
  it('knows Intuniv as guanfacine, with what to know', () => {
    const [g] = medGuideFor(med('a', 'Intuniv'));
    expect(g.id).toBe('guanfacine');
    expect(g.know.join(' ')).toMatch(/stop suddenly/i);
    expect(g.food).toMatch(/high-fat/);
  });
  it('every entry is complete, with unique ids and a known area', () => {
    const ids = new Set<string>();
    for (const g of MED_GUIDE) {
      expect(ids.has(g.id), g.id).toBe(false); ids.add(g.id);
      expect(AREAS).toContain(g.area);
      expect(g.take.length + g.know.length, g.id).toBeGreaterThan(0);
      expect(g.common.length, g.id).toBeGreaterThan(0);
      expect(g.generics.length, g.id).toBeGreaterThan(0);
    }
    expect(MED_GUIDE.length).toBeGreaterThan(80);
  });
  it('a generic belongs to one entry', () => {
    const seen = new Map<string, string>();
    for (const g of MED_GUIDE) for (const n of g.generics) { expect(seen.get(n), `${n} in ${g.id} and ${seen.get(n)}`).toBeUndefined(); seen.set(n, g.id); }
  });
  it('brand names on the list lead to an entry', () => {
    const covered = new Set(MED_GUIDE.flatMap((g) => g.generics));
    const not = ['naloxone', 'linezolid'];
    const missing = [...new Set(MED_NAMES.map(([, g]) => g))].filter((g) => !covered.has(g) && !not.includes(g));
    expect(missing).toEqual([]);
  });
  it('the guide is never about changing a dose or its timing on your own', () => {
    const text = MED_GUIDE.flatMap((g) => [...g.take, ...g.know, g.alcohol ?? '', g.food ?? '', ...(g.app ?? [])]).join(' \n ');
    expect(text).not.toMatch(/\b(skip (a|your) dose|double (up|the dose)|take (it )?(earlier|later)|increase your dose|reduce your dose|stop taking it)\b/i);
  });
  it('a combined pill is the combined pill only', () => {
    expect(medGuideFor(med('p', 'Levlen ED')).map((g) => g.id)).toEqual(['combined-pill']);
  });
  it('search finds by brand and by use', () => {
    expect(searchGuide('intuniv').map((g) => g.id)).toContain('guanfacine');
    expect(searchGuide('reflux').length).toBeGreaterThan(2);
  });
});

describe('interactions for the guide', () => {
  const who = () => 'me';
  it('guanfacine with a stimulant: often prescribed together (info)', () => {
    const r = interactions([med('g', 'Intuniv'), med('v', 'Vyvanse')], who);
    expect(r).toHaveLength(1); expect(r[0].level).toBe('info');
  });
  it('guanfacine with clarithromycin: levels raised', () => {
    const r = interactions([med('g', 'Intuniv'), med('c', 'Klacid')], who);
    expect(r[0].why).toMatch(/raises guanfacine/i);
  });
  it('guanfacine with a beta blocker or a sedative', () => {
    expect(interactions([med('g', 'Intuniv'), med('b', 'Metoprolol')], who)[0].why).toMatch(/slow the heart/);
    expect(interactions([med('g', 'Guanfacine'), med('s', 'Quetiapine')], who)[0].why).toMatch(/drowsy/);
  });
  it('two QT medicines, and naltrexone with an opioid', () => {
    expect(interactions([med('a', 'Escitalopram'), med('b', 'Ondansetron')], who)[0].why).toMatch(/QT/);
    expect(interactions([med('a', 'Naltrexone'), med('b', 'Endone')], who)[0].level).toBe('avoid');
  });
});
