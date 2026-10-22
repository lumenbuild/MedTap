// What the home-screen widget shows, and the "Log <medicine>" shortcuts: the most urgent scheduled dose (with what to
// draw for an injection) and up to two as-needed medicines. Pure; names follow the privacy setting (nicknames).
import type { Dose, Medication } from '../db/schema';
import { byUrgency, getExpectedAmount, getNextDue, getStatus, type ScheduleSettings } from './schedule';
import { fmtAmount, fmtTime, fmtWhen } from './format';
import { guideText } from './peptide';
import { shownName } from './privacy';

export interface WidgetData { app: string; label: string; title: string; when: string; dueAt: number | null; detail: string; logId: string; prn: { id: string; name: string }[] }

export function widgetData(app: string, meds: Medication[], doses: Dose[], now: number, s: ScheduleSettings): WidgetData {
  const active = meds.filter((m) => !m.archived);
  const scheduled = byUrgency(active.filter((m) => m.schedule.type !== 'prn'), doses, now, s);
  const prn = active.filter((m) => m.schedule.type === 'prn').slice(0, 2).map((m) => ({ id: m.id, name: shownName(m) }));
  const m = scheduled[0];
  if (!m) return { app, label: app, title: prn.length ? 'As needed' : '', when: '', dueAt: null, detail: '', logId: '', prn };
  const status = getStatus(m, doses, now, s);
  const next = getNextDue(m, doses, now, s);
  const amount = next !== null ? getExpectedAmount(m, doses, next, s) : m.defaultAmount;
  const guide = m.peptide ? guideText(m, amount) : undefined;
  const detail = [fmtAmount(amount, m.unit), guide].filter(Boolean).join(' · ');
  if (status === 'due') return { app, label: 'Due now', title: shownName(m), when: next ? `since ${fmtTime(next)}` : '', dueAt: null, detail, logId: m.id, prn };
  if (status === 'done-today' && (next === null || next - now > 12 * 3_600_000)) return { app, label: 'Done for today', title: shownName(m), when: next ? `Next ${fmtWhen(next, now)}` : '', dueAt: null, detail: '', logId: m.id, prn };
  return { app, label: 'Next', title: shownName(m), when: next ? fmtWhen(next, now) : '', dueAt: next, detail, logId: m.id, prn };
}

/** Shortcuts: scheduled medicines first, then as-needed; at most 4 (Android shows 4 on a long press). */
export function shortcutItems(meds: Medication[]): { id: string; label: string }[] {
  const active = meds.filter((m) => !m.archived);
  return [...active.filter((m) => m.schedule.type !== 'prn'), ...active.filter((m) => m.schedule.type === 'prn')].slice(0, 4).map((m) => ({ id: m.id, label: `Log ${shownName(m)}` }));
}
