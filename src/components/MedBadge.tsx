import { Bandage, Droplet, Pill, SprayCan, Syringe, Tablets, type LucideIcon } from 'lucide-react';
import { medColour, medInk, type MedIconName } from '../logic/palette';

export const MED_ICON_COMPONENTS: Record<MedIconName, LucideIcon> = {
  pill: Pill, tablets: Tablets, droplet: Droplet, syringe: Syringe, bandage: Bandage, spray: SprayCan,
};

/** The medication's colour and icon, as a round chip. */
export function MedBadge({ color, icon, size = 40 }: { color: string; icon: string; size?: number }) {
  const Icon = MED_ICON_COMPONENTS[icon as MedIconName] ?? Pill;
  return (
    <span className="inline-flex items-center justify-center rounded-full shrink-0" style={{ background: medColour(color), color: medInk(color), width: size, height: size }} aria-hidden="true">
      <Icon size={size * 0.5} />
    </span>
  );
}
