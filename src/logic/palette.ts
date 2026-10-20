// Fixed medication colours, used for chips, rings and chart series. Validated as a categorical palette
// (colour-blind-safe in this order) with separate light and dark steps, defined as --med-1…8 in tokens.css.
// A medication stores its light hex as its identity; the UI always draws through the CSS variable,
// so dark mode gets the dark step.
export const MED_COLOURS = [
  { value: '#2a78d6', name: 'Blue' },
  { value: '#eb6834', name: 'Orange' },
  { value: '#1baf7a', name: 'Aqua' },
  { value: '#eda100', name: 'Yellow' },
  { value: '#e87ba4', name: 'Pink' },
  { value: '#008300', name: 'Green' },
  { value: '#6250d6', name: 'Violet' },
  { value: '#e34948', name: 'Red' },
] as const;

const slot = (hex: string) => MED_COLOURS.findIndex((c) => c.value.toLowerCase() === hex.toLowerCase()) + 1;

/** CSS colour for a medication's stored colour (themed via CSS variables). 'private' is the plain grey for nicknames. */
export const medColour = (hex: string) => (hex === 'private' ? 'var(--med-private)' : slot(hex) ? `var(--med-${slot(hex)})` : hex);
/** Icon/text colour to put on top of the medication colour. */
export const medInk = (hex: string) => (hex === 'private' ? 'var(--med-private-ink)' : slot(hex) ? `var(--med-${slot(hex)}-ink)` : '#FFFFFF');

/** Resolve a CSS colour (including var(--x)) to a concrete value, for canvas charts. */
export function resolveColour(css: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(css);
  if (!m || typeof document === 'undefined') return css;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || css;
}

/** Colours from before the palette was validated (Phase 1), mapped to the nearest new hue. */
export const LEGACY_COLOURS: Record<string, string> = {
  '#0b7a75': '#1baf7a', '#2563eb': '#2a78d6', '#7c3aed': '#6250d6', '#c026d3': '#e87ba4',
  '#db2777': '#e34948', '#ea580c': '#eb6834', '#ca8a04': '#eda100', '#16a34a': '#008300',
};

export const MED_ICONS = ['pill', 'tablets', 'droplet', 'syringe', 'bandage', 'spray'] as const;
export type MedIconName = (typeof MED_ICONS)[number];
