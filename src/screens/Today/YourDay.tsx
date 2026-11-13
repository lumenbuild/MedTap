// Today's one card for the day so far: the doses, then every number for the day as the same kind of tile (what it
// is, how far along, a + to add to it), then the other things to log. One look and one way of working for all of it,
// in place of separate cards for rings, intake, food and caffeine that each had their own.
import type { ReactNode } from 'react';
import { Plus, type LucideIcon } from 'lucide-react';
import { SectionHead } from '../../components/TodayPlan';

export interface DayTileData {
  key: string; label: string; Icon: LucideIcon; colour: string;
  /** The day's figure, and its target with the unit ("1.5" and "/ 3.8 L"). */
  value: string; of?: string;
  /** How far towards the target, 0–1 (no bar without one). */
  frac?: number;
  /** One short line under it ("14 mg in you now"). */
  sub?: string;
  tone?: 'watch' | 'good';
  href?: string; onOpen?: () => void;
  onAdd?: () => void; addLabel?: string;
}

export function YourDay({ streak, children, tiles, chips, actions }: {
  streak?: string; children?: ReactNode; tiles: DayTileData[]; chips?: ReactNode;
  actions: { label: string; Icon: LucideIcon; onClick: () => void; name?: string }[];
}) {
  return (
    <section className="box" aria-labelledby="day-h">
      <SectionHead id="day-h" title="Your day" extra={streak ? <span className="ml-auto text-[13px] text-muted tnum">{streak}</span> : undefined} />
      {children}
      {tiles.length > 0 && <ul className="grid grid-cols-2 gap-2 mt-2">{tiles.map((t) => <DayTile key={t.key} t={t} />)}</ul>}
      {chips && <div className="mt-3">{chips}</div>}
      {actions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border">
          <p className="text-[13px] text-muted mb-2">Also log</p>
          <ul className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <li key={a.label}><button type="button" onClick={a.onClick} aria-label={a.name ?? a.label}
                className="inline-flex items-center gap-1.5 min-h-[40px] pl-2.5 pr-3.5 rounded-full bg-surface-2 text-[14px] font-medium active:scale-[0.97] transition-transform">
                <a.Icon size={17} aria-hidden="true" className="text-primary" />{a.label}
              </button></li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function DayTile({ t }: { t: DayTileData }) {
  const pct = t.frac === undefined ? undefined : Math.max(0, Math.min(1, t.frac));
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted pr-9">
        <span aria-hidden="true" className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center text-white shrink-0" style={{ background: t.colour }}><t.Icon size={13} /></span>
        {t.label}
      </span>
      <span className="block mt-2 tnum leading-none whitespace-nowrap"><span className="text-[22px] font-bold">{t.value}</span>{t.of && <span className="text-[13px] text-muted"> {t.of}</span>}</span>
      {pct !== undefined && (
        <span aria-hidden="true" className="block mt-2 h-1.5 rounded-full bg-border overflow-hidden">
          <span className="block h-full rounded-full" style={{ width: `${pct * 100}%`, background: t.tone === 'watch' ? 'var(--caution)' : pct >= 1 ? 'var(--success)' : t.colour }} />
        </span>
      )}
      {t.sub && <span className={`block mt-1.5 text-[12px] leading-snug ${t.tone === 'watch' ? 'text-text font-medium' : 'text-muted'}`}>{t.sub}</span>}
    </>
  );
  const name = `${t.label}: ${t.value}${t.of ? ` ${t.of}` : ''}${t.sub ? `. ${t.sub}` : ''}`;
  const cls = 'flex flex-col justify-start w-full h-full text-left rounded-[14px] bg-surface-2 p-3 min-h-[96px] active:scale-[0.98] transition-transform';
  return (
    <li className="relative">
      {t.href ? <a href={t.href} aria-label={name} className={cls}>{body}</a>
        : t.onOpen ? <button type="button" onClick={t.onOpen} aria-label={name} className={cls}>{body}</button>
          : <div className={cls}>{body}</div>}
      {t.onAdd && (
        <button type="button" onClick={t.onAdd} aria-label={t.addLabel ?? `Add ${t.label.toLowerCase()}`}
          className="absolute top-2 right-2 w-9 h-9 rounded-full bg-surface flex items-center justify-center shadow-card active:scale-95 transition-transform" style={{ color: t.colour }}>
          <Plus size={20} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}
