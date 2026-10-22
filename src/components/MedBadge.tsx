import { Bandage, Droplet, Pill, SprayCan, Syringe, Tablets, type LucideIcon } from 'lucide-react';
import { medColour, type MedIconName } from '../logic/palette';

export const MED_ICON_COMPONENTS: Record<MedIconName, LucideIcon> = {
  pill: Pill, tablets: Tablets, droplet: Droplet, syringe: Syringe, bandage: Bandage, spray: SprayCan,
};

/** The medication's colour as a small dot (B2: colour comes only from the medicines). Nicknamed ones are plain grey. */
export function MedBadge({ color, size = 40 }: { color: string; icon?: string; size?: number }) {
  const dot = Math.max(10, Math.round(size * 0.3));
  return <span className="inline-block rounded-full shrink-0" style={{ background: medColour(color), width: dot, height: dot }} aria-hidden="true" />;
}
