// The week, explained and planned: which of the things that move your results happened more (or less) than usual
// last week, and the three changes most likely to help next week, from the person's own drivers and weight levers.
// Pure.
import type { Drivers, Driver } from './drivers';
import type { Lever } from './aheadSmarts';

export interface WeekCause { topic: string; result: string; label: string; days: number; usual: number; text: string; helps: boolean }
export interface NextLever { title: string; why: string; kind: 'more' | 'less' | 'lever' }

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
// Only habits are levers. Medicines never are (doses are for the prescriber), and healthy habits are never something
// to do less of, whatever a few weeks of data say.
const LESS = new Set(['late-caffeine', 'alcohol', 'late-meal', 'salty']);
const MORE = new Set(['steps', 'workout', 'mindful', 'protein']);
const isMed = (key: string) => key.startsWith('med-');

/** For each result, the drivers that ran well off their usual last week (Monday `from` to Sunday `to`, inclusive keys). */
export function weekCauses(all: Drivers[], from: string, to: string, windowDays = 90): WeekCause[] {
  const out: WeekCause[] = [];
  for (const d of all) for (const x of d.drivers) {
    if (isMed(x.key)) continue;
    const days = x.on.filter((k) => k >= from && k <= to).length;
    const usual = Math.round((x.on.length / windowDays) * 7 * 10) / 10;
    if (Math.abs(days - usual) < 1.5) continue;
    // More of something that hurts, or less of something that helps, explains a worse week; the reverse a better one.
    const worse = (days > usual) !== x.helps;
    out.push({ topic: d.topic, result: d.label, label: x.label, days, usual, helps: !worse,
      text: `${x.label}: ${days} day${days === 1 ? '' : 's'} (usually about ${Math.round(usual)}), which goes with ${x.text} ${lower(d.label)}` });
  }
  return out.sort((a, b) => Math.abs(b.days - b.usual) - Math.abs(a.days - a.usual)).slice(0, 5);
}

/** Next week's three levers: cut back what hurt most often, do more of what helps that was rare, and the biggest
 *  weight lever. Strongest first, one per thing. */
export function nextLevers(all: Drivers[], from: string, to: string, levers: Lever[] = []): NextLever[] {
  const cands: (NextLever & { score: number; key: string })[] = [];
  for (const d of all) for (const x of d.drivers as Driver[]) {
    const days = x.on.filter((k) => k >= from && k <= to).length;
    const size = Math.abs(x.diff) / Math.max(1e-9, Math.abs(x.without) || 1) * (x.sure === 'clear' ? 1.5 : 1);
    if (!x.helps && days >= 2 && LESS.has(x.key)) cands.push({ key: x.key, kind: 'less', title: `Fewer days with ${lower(x.label)}`, why: `${days} days last week; on those days your ${lower(d.label)} runs ${x.text}.`, score: size * days });
    if (x.helps && days <= 4 && MORE.has(x.key)) cands.push({ key: x.key, kind: 'more', title: `More days with ${lower(x.label)}`, why: `${days} day${days === 1 ? '' : 's'} last week; it goes with ${x.text} ${lower(d.label)}.`, score: size * (7 - days) * 0.8 });
  }
  const lv = [...levers].sort((a, b) => b.days - a.days)[0];
  if (lv && lv.days >= 3) cands.push({ key: 'lever', kind: 'lever', title: lv.what.replace(/^./, (c) => c.toUpperCase()), why: `Kept up for a month, it brings your goal about ${lv.days} days closer.`, score: 0.05 * lv.days });
  const seen = new Set<string>();
  return cands.sort((a, b) => b.score - a.score).filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true))).slice(0, 3).map(({ score: _s, key: _k, ...c }) => c);
}
