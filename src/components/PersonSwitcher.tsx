import { Users } from 'lucide-react';
import { useFamily } from '../app/data';
import { setSetting } from '../db/repos/settings';

export const initials = (name: string) => name.trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';

/** Round initials badge for a family member. */
export function PersonBadge({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center justify-center rounded-full bg-primary-soft text-primary font-semibold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.42 }}>{initials(name)}</span>
  );
}

/** Who's being shown. Only appears once there's more than one family member. Today can also show everyone. */
export function PersonSwitcher({ allowEveryone = false }: { allowEveryone?: boolean }) {
  const fam = useFamily();
  if (!fam || !fam.many) return null;
  const current = allowEveryone && fam.everyone ? 'all' : fam.personId;
  const pick = async (id: string) => {
    if (id === 'all') { await setSetting('todayEveryone', true); return; }
    await setSetting('activePersonId', id);
    await setSetting('todayEveryone', false);
  };
  const options = [...(allowEveryone ? [{ id: 'all', name: 'Everyone' }] : []), ...fam.people.map((p) => ({ id: p.id, name: p.name }))];
  return (
    <div role="radiogroup" aria-label="Family member" className="-mx-4 px-4 flex gap-2 overflow-x-auto no-scrollbar pb-1">
      {options.map((o) => {
        const on = o.id === current;
        return (
          <button key={o.id} role="radio" aria-checked={on} onClick={() => pick(o.id)}
            className={`shrink-0 min-h-[44px] pl-1.5 pr-4 rounded-chip flex items-center gap-2 font-medium border transition-colors ${on ? 'bg-primary text-on-primary border-primary' : 'bg-surface border-border'}`}>
            {o.id === 'all'
              ? <span className={`w-8 h-8 rounded-full flex items-center justify-center ${on ? 'bg-white/20' : 'bg-primary-soft text-primary'}`}><Users size={16} aria-hidden="true" /></span>
              : <PersonBadge name={o.name} size={32} />}
            {o.name}
          </button>
        );
      })}
    </div>
  );
}
