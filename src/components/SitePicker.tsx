// Where the shot goes: a simple front-view body with the eight usual sites. The next site in the rotation is picked
// for you (never used, else the longest ago); a site used in the last week is marked, with when.
import type { Dose } from '../db/schema';
import { siteRotation, siteTooSoon, SITES } from '../logic/peptideSmart';

// Front view: the person's left is on the viewer's right.
const SPOTS: Record<(typeof SITES)[number], [number, number]> = {
  'Belly, upper left': [68, 64], 'Belly, upper right': [52, 64], 'Belly, lower left': [68, 84], 'Belly, lower right': [52, 84],
  'Thigh, left': [69, 128], 'Thigh, right': [51, 128], 'Arm, left': [88, 62], 'Arm, right': [32, 62],
};

export function SitePicker({ doses, now, value, onChange }: { doses: Dose[]; now: number; value: string | undefined; onChange: (s: string | undefined) => void }) {
  const rot = siteRotation(doses, now);
  const use = (s: string) => rot.sites.find((x) => x.site === s);
  const soon = value ? siteTooSoon(use(value), now) : undefined;
  return (
    <div className="space-y-1.5">
      <span className="block text-sm font-medium">Site</span>
      <div className="flex items-center gap-4">
        <svg viewBox="0 0 120 196" className="w-[120px] shrink-0" role="group" aria-label="Injection site">
          <circle cx="60" cy="16" r="11" fill="var(--surface-2)" stroke="var(--border-strong)" />
          <rect x="40" y="32" width="40" height="68" rx="10" fill="var(--surface-2)" stroke="var(--border-strong)" />
          <rect x="26" y="34" width="12" height="62" rx="6" fill="var(--surface-2)" stroke="var(--border-strong)" />
          <rect x="82" y="34" width="12" height="62" rx="6" fill="var(--surface-2)" stroke="var(--border-strong)" />
          <rect x="43" y="102" width="15" height="88" rx="7" fill="var(--surface-2)" stroke="var(--border-strong)" />
          <rect x="62" y="102" width="15" height="88" rx="7" fill="var(--surface-2)" stroke="var(--border-strong)" />
          {SITES.map((s) => {
            const [x, y] = SPOTS[s];
            const on = value === s, recent = !!siteTooSoon(use(s), now);
            return (
              <g key={s} role="button" tabIndex={0} aria-pressed={on} aria-label={`${s}${recent ? `, ${siteTooSoon(use(s), now)!.toLowerCase()}` : ''}${s === rot.next ? ', next in rotation' : ''}`}
                onClick={() => onChange(on ? undefined : s)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(on ? undefined : s); } }} className="cursor-pointer outline-none">
                <circle cx={x} cy={y} r="11" fill="transparent" />
                <circle cx={x} cy={y} r="6.5" fill={on ? 'var(--primary)' : recent ? 'var(--caution-soft)' : 'var(--surface)'} stroke={on ? 'var(--primary)' : recent ? 'var(--caution)' : 'var(--text-muted)'} strokeWidth="1.5" />
              </g>
            );
          })}
        </svg>
        <div className="text-sm space-y-1 min-w-0">
          <p className="font-medium">{value ?? 'None chosen'}</p>
          {soon ? <p className="text-caution">{soon}: another site is kinder to the skin.</p>
            : value ? <p className="text-muted">{use(value)?.lastAt ? `Last used ${Math.floor((now - use(value)!.lastAt!) / 86_400_000)} days ago` : 'Not used yet'}</p> : null}
          {value !== rot.next && <button type="button" className="min-h-[44px] text-primary font-semibold" onClick={() => onChange(rot.next)}>Next in rotation: {rot.next}</button>}
          <p className="text-[12px] text-muted">Your left is on the right of the picture.</p>
        </div>
      </div>
    </div>
  );
}
