// How long common ADHD and wakefulness medicines usually work, by name or active ingredient: a sanity check on what's
// learned from check-ins (so a stray "wearing off" note can't make Ritalin last an hour). Ranges from product
// information; people vary, so it's only a bound. Pure.
import type { Medication } from '../db/schema';

/** Usual hours of effect, low to high, or undefined when the medicine isn't one we know. Extended-release forms first. */
export function usualHours(med: Pick<Medication, 'name' | 'ingredients'>): { min: number; max: number; name: string } | undefined {
  const text = [med.name, ...(med.ingredients ?? []).map((i) => i.name)].join(' ').toLowerCase();
  const table: [RegExp, number, number, string][] = [
    [/concerta|ritalin\s*la|ritalin\s*sr|biphentin|jornay|quillichew|aptensio|metadate|methylphenidate\s*(er|sr|la|cr|xr|ext)/, 8, 12, 'extended-release methylphenidate'],
    [/focalin\s*xr|dexmethylphenidate\s*(er|xr)/, 8, 12, 'extended-release dexmethylphenidate'],
    [/ritalin|methylphenidate|methylin|focalin|dexmethylphenidate/, 3, 5, 'methylphenidate'],
    [/vyvanse|elvanse|lisdexamfetamine|lisdexamphetamine/, 10, 13, 'lisdexamfetamine'],
    [/adderall\s*xr|mydayis|dyanavel|adzenys/, 10, 12, 'extended-release amphetamine'],
    [/adderall|dexamfetamine|dexamphetamine|dextroamphetamine|dexedrine|zenzedi|evekeo|amphetamine/, 4, 6, 'dexamfetamine'],
    [/armodafinil|nuvigil/, 10, 15, 'armodafinil'],
    [/modafinil|modavigil|provigil/, 10, 15, 'modafinil'],
  ];
  for (const [re, min, max, name] of table) if (re.test(text)) return { min, max, name };
  return undefined;
}

/** A learned wear-off time that's believable for this medicine: from half its shortest to half again its longest.
 *  Unknown medicines: at least 1½ hours. */
export function plausibleHours(med: Pick<Medication, 'name' | 'ingredients'>, h: number): boolean {
  const u = usualHours(med);
  return u ? h >= Math.max(1.5, u.min * 0.5) && h <= u.max * 1.5 : h >= 1.5;
}
