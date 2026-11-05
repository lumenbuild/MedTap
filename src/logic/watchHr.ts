// Heart rate straight from the watch (its background readings, sent in batches): averaged into each day's 5-minute
// blocks and hours, the same shape Health Connect gives, so everything that uses heart rate after a dose has today's
// as it happens. Where a block already has a value (from Health Connect, or an earlier batch) the two are averaged
// by how many readings each had; Health Connect's own later import fills gaps the watch missed. Pure.
import type { DailyHealth } from '../db/schema';

const ymdIn = (t: number, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const minuteOfDay = (t: number, tz: string) => {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(t);
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
};

export interface HrSample { t: number; bpm: number }

/** The daily rows to write: each date's hr5 (288 five-minute averages) and hrByHour (24), with the watch's samples in. */
export function mergeHrSamples(existing: DailyHealth[], samples: HrSample[], personId: string | undefined, tz: string, nowIso: string): DailyHealth[] {
  const byDate = new Map<string, HrSample[]>();
  for (const s of samples) {
    if (!(s.bpm >= 30 && s.bpm <= 230) || !Number.isFinite(s.t)) continue;
    const k = ymdIn(s.t, tz);
    byDate.set(k, [...(byDate.get(k) ?? []), s]);
  }
  const out: DailyHealth[] = [];
  for (const [date, list] of byDate) {
    const old = existing.find((d) => !d.deletedAt && d.date === date && (d.personId ?? undefined) === personId);
    const sum5 = new Array(288).fill(0), n5 = new Array(288).fill(0);
    for (const s of list) { const b = Math.floor(minuteOfDay(s.t, tz) / 5); sum5[b] += s.bpm; n5[b]++; }
    // Blocks already there count as one reading each (they're already averages).
    const hr5 = Array.from({ length: 288 }, (_, b) => {
      const prev = old?.hr5?.[b];
      const n = n5[b] + (typeof prev === 'number' ? 1 : 0);
      return n ? Math.round((sum5[b] + (typeof prev === 'number' ? prev : 0)) / n) : (prev ?? null);
    });
    const hrByHour = Array.from({ length: 24 }, (_, h) => {
      const blocks = hr5.slice(h * 12, h * 12 + 12).filter((v): v is number => typeof v === 'number');
      return blocks.length ? Math.round(blocks.reduce((a, v) => a + v, 0) / blocks.length) : (old?.hrByHour?.[h] ?? null);
    });
    out.push({ ...(old ?? { id: crypto.randomUUID(), date, personId, createdAt: nowIso }), hr5, hrByHour, updatedAt: nowIso });
  }
  return out;
}

/** Health Connect's blocks over what's there: its value where it has one, else what the watch already sent. */
export function mergeBlocks(fresh: (number | null)[] | undefined, old: (number | null)[] | undefined): (number | null)[] | undefined {
  if (!fresh) return old;
  if (!old) return fresh;
  return fresh.map((v, i) => (typeof v === 'number' ? v : old[i] ?? null));
}
