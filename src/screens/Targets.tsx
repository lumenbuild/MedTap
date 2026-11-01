// Your targets: water, protein, calories, fibre, steps, sleep and caffeine, each worked out from your own data and
// kept up to date, or your own number. Tap one to switch.
import { useEffect, useState } from 'react';
import { Coffee, Droplet, Footprints, Moon, Flame, Wheat, Beef, Sparkles, type LucideIcon } from 'lucide-react';
import { useSettings } from '../app/data';
import { setAutoTarget, setOwnTarget, targetSuggestions } from '../app/targets';
import { updateCalorieTarget } from '../app/maintenance';
import { currentTarget, differs, fmtTarget, isAuto, LABEL, TARGET_KEYS, type Suggestion, type TargetKey } from '../logic/targets';
import { fmtAgo } from '../logic/format';
import { HAS_FOOD } from '../edition';
import { Sheet } from '../components/ui/Sheet';
import { Switch } from '../components/ui/Switch';
import { Button } from '../components/ui/Button';
import { TextInput } from '../components/ui/Field';
import { useToast } from '../app/toast';

const LOOK: Record<TargetKey, { Icon: LucideIcon; tone: string; unit: string; step: number }> = {
  water: { Icon: Droplet, tone: 'body', unit: 'mL', step: 50 },
  protein: { Icon: Beef, tone: 'act', unit: 'g', step: 5 },
  calories: { Icon: Flame, tone: 'act', unit: 'Cal', step: 10 },
  fibre: { Icon: Wheat, tone: 'body', unit: 'g', step: 1 },
  steps: { Icon: Footprints, tone: 'act', unit: 'steps', step: 500 },
  sleep: { Icon: Moon, tone: 'sleep', unit: 'hours', step: 0.5 },
  caffeine: { Icon: Coffee, tone: 'mind', unit: 'mg', step: 25 },
};

export function Targets() {
  const st = useSettings();
  const [sug, setSug] = useState<Partial<Record<TargetKey, Suggestion>> | null>(null);
  const [open, setOpen] = useState<TargetKey | null>(null);
  // Worked out again whenever a setting changes (a weight, a goal, a target).
  useEffect(() => { if (st) targetSuggestions(st).then(setSug).catch(() => setSug({})); }, [st]);
  if (!st || !sug) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const keys = TARGET_KEYS.filter((k) => (k === 'calories' || k === 'fibre' ? HAS_FOOD && st.foodTracking : k === 'sleep' ? st.sleepTools : true));
  const autoCount = keys.filter((k) => isAuto(st, k)).length;
  const recent = st.targetChanges.filter((c) => keys.includes(c.key as TargetKey)).slice(0, 5);
  return (
    <div className="space-y-3 pb-8">
      <section className="hero body" aria-label="Targets">
        <p className="hero-label">Your targets</p>
        <p className="mt-1 text-[30px] leading-9 font-bold tnum">{autoCount} of {keys.length} <span className="text-[17px] font-semibold">automatic</span></p>
        <p className="text-muted text-[15px]">Worked out from your weight, activity, sleep and what you log, and kept up to date. Tap one to set your own.</p>
      </section>

      <div className="grid grid-cols-2 gap-2">
        {keys.map((k) => {
          const L = LOOK[k]; const auto = isAuto(st, k); const cur = currentTarget(st, k, sug); const s = sug[k];
          const better = !auto && s && differs(k, cur, s.value);
          return (
            <button key={k} type="button" onClick={() => setOpen(k)} className="box text-left !p-3 flex flex-col gap-1.5 min-h-[132px]" aria-label={`${LABEL[k]}: ${fmtTarget(k, cur)}, ${auto ? 'automatic' : 'your own'}`}>
              <span className="flex items-center gap-1.5 text-[13px] font-medium text-muted">
                <span aria-hidden="true" className="w-[22px] h-[22px] rounded-[7px] flex items-center justify-center text-white" style={{ background: `var(--c-${L.tone})` }}><L.Icon size={13} /></span>{LABEL[k]}
              </span>
              <span className="text-[24px] leading-7 font-bold tnum">{fmtTarget(k, cur)}</span>
              <span className="text-[12px] leading-4 text-muted line-clamp-2">{auto ? s?.why ?? (k === 'calories' ? 'Needs about 2 weeks of food and weigh-ins' : 'Needs a little more data') : better ? `Suggested ${fmtTarget(k, s!.value)}` : 'Your own number'}</span>
              <span className={`mt-auto self-start text-[11px] font-semibold rounded-full px-2 py-0.5 ${auto ? 'bg-success-soft text-success' : better ? 'bg-caution-soft' : 'bg-surface-2 text-muted'}`}>
                {auto ? 'Auto' : better ? 'Update?' : 'Own'}
              </span>
            </button>
          );
        })}
      </div>

      {recent.length > 0 && (
        <section className="box space-y-1" aria-labelledby="tc-h">
          <h2 id="tc-h" className="text-sm font-medium text-muted flex items-center gap-1.5"><Sparkles size={15} aria-hidden="true" />Recently updated</h2>
          <ul className="divide-y divide-border">
            {recent.map((c) => (
              <li key={`${c.key}-${c.at}`} className="py-2 text-[15px] tnum">
                <span className="font-semibold">{LABEL[c.key as TargetKey]}</span> {fmtTarget(c.key as TargetKey, c.from)} → {fmtTarget(c.key as TargetKey, c.to)}
                <span className="block text-[13px] text-muted">{c.why} · {fmtAgo(Date.now() - c.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {open && <TargetSheet k={open} sug={sug[open]} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TargetSheet({ k, sug, onClose }: { k: TargetKey; sug?: Suggestion; onClose: () => void }) {
  const st = useSettings();
  const toast = useToast();
  if (!st) return null;
  const auto = isAuto(st, k);
  const cur = currentTarget(st, k, sug ? { [k]: sug } : {});
  const L = LOOK[k];
  const toAuto = async () => { await setAutoTarget(k); if (k === 'calories') await updateCalorieTarget(); toast(`${LABEL[k]}: automatic`); };
  return (
    <Sheet open onClose={onClose} title={LABEL[k]}>
      <div className="space-y-4">
        <div>
          <p className="text-[34px] leading-10 font-bold tnum">{fmtTarget(k, cur)}</p>
          {sug && <p className="text-muted text-[15px]">{auto ? sug.why : `Suggested ${fmtTarget(k, sug.value)}: ${sug.why.charAt(0).toLowerCase()}${sug.why.slice(1)}`}</p>}
        </div>
        <Switch label="Set automatically" checked={auto} onChange={async (v) => { if (v) await toAuto(); else await setOwnTarget(k, cur); }}>
          {auto ? 'Updates as your data changes' : 'Off: your own number stays as it is'}
        </Switch>
        {!auto && (
          <TextInput key={`${k}-${cur}`} label={`Your target (${L.unit})`} type="number" inputMode="decimal" min="0" step={String(L.step)}
            defaultValue={cur === null ? '' : String(k === 'sleep' ? cur : Math.round(cur))}
            onBlur={(e) => { const n = Number(e.target.value); const v = e.target.value.trim() && n > 0 ? (k === 'sleep' ? Math.round(n * 2) / 2 : Math.round(n)) : null; if (v !== cur) void setOwnTarget(k, v); }} />
        )}
        {!auto && sug && differs(k, cur, sug.value) && <Button variant="secondary" className="w-full" onClick={toAuto}>Use {fmtTarget(k, sug.value)} and keep it updated</Button>}
      </div>
    </Sheet>
  );
}
