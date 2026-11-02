// Saving a smart scale's full readings (its export, or a screenshot) into Body.
import { db } from '../db/db';
import { DEFAULT_PERSON } from '../db/schema';
import { upsertBody } from '../db/repos/body';
import { parseScaleCsv, parseScaleScreen, planScaleImport, type ScaleReading } from '../logic/scaleImport';
import { requestScaleReview } from './shareInbox';

/** Save the readings for `personId`, one a day, filling only what each day lacks. Returns the days changed. */
export async function saveScaleReadings(readings: ScaleReading[], personId: string): Promise<number> {
  const existing = await db.bodyEntries.toArray();
  const plan = planScaleImport(readings, existing, personId === DEFAULT_PERSON ? undefined : personId);
  for (const p of plan) await upsertBody(p.date, p.fields, personId);
  return plan.length;
}

/** A file shared to the app or opened with it: a scale app's export is imported straight away; a screenshot of a
 *  reading opens Body to check it first. */
export async function onSharedFile(e: { text?: string; image?: string; mime?: string }, personId: string, bodyPath: string, go: (p: string) => void) {
  const notice = (m: string) => window.dispatchEvent(new CustomEvent('medtap-toast', { detail: m }));
  if (e.text) {
    const rs = parseScaleCsv(e.text);
    if (!rs.length) { notice('That file has no weigh-ins MedTap can read. Share the scale app’s data export (CSV).'); return; }
    const n = await saveScaleReadings(rs, personId);
    go(bodyPath);
    notice(n ? `Scale export: ${rs.length} weigh-ins added across ${n} days.` : 'Everything in that export was already here.');
    return;
  }
  if (e.image) {
    const bin = atob(e.image), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const { readText } = await import('./ocr');
    const r = parseScaleScreen(await readText(new Blob([bytes], { type: e.mime ?? 'image/png' }), () => undefined), localYmd());
    if (!r) { notice('Couldn’t find a scale reading in that picture.'); return; }
    go(bodyPath);
    requestScaleReview(r);
  }
}

const localYmd = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
