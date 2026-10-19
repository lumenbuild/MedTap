// Fixed medication colours: accessible on light and dark surfaces, used for chips, rings and chart series.
export const MED_COLOURS = [
  { value: '#0B7A75', name: 'Teal' },
  { value: '#2563EB', name: 'Blue' },
  { value: '#7C3AED', name: 'Violet' },
  { value: '#C026D3', name: 'Magenta' },
  { value: '#DB2777', name: 'Pink' },
  { value: '#EA580C', name: 'Orange' },
  { value: '#CA8A04', name: 'Gold' },
  { value: '#16A34A', name: 'Green' },
] as const;

export const MED_ICONS = ['pill', 'tablets', 'droplet', 'syringe', 'bandage', 'spray'] as const;
export type MedIconName = (typeof MED_ICONS)[number];
