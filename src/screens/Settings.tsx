import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { getTheme, setTheme, type Theme } from '../app/theme';
import { APP_NAME, DISCLAIMER } from '../config';
import { isIOS, isStandalone } from '../platform';
import { useSettings } from '../app/data';
import { setSetting } from '../db/repos/settings';
import { fmtHHmm } from '../logic/format';

export function Settings() {
  const [theme, setT] = useState<Theme>(getTheme());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const check = async () => setPersisted((await navigator.storage?.persist?.()) ?? false);
  const settings = useSettings();

  return (
    <div className="space-y-4">
      {settings && (
        <Card className="space-y-4">
          <h2 className="text-lg font-semibold">Your day</h2>
          <div className="space-y-1.5">
            <label htmlFor="day-start" className="block text-sm font-medium">Day starts at</label>
            <input id="day-start" type="time" value={settings.dayStartsAt} required
              onChange={(e) => e.target.value && setSetting('dayStartsAt', e.target.value)}
              className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3 tnum" />
            <p className="text-sm text-muted">
              Doses before {fmtHHmm(settings.dayStartsAt)} count towards the day before, so a late-night dose stays with the right day.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="guard" className="block text-sm font-medium">Ask before logging twice within</label>
            <select id="guard" value={settings.guardMinutes} onChange={(e) => setSetting('guardMinutes', Number(e.target.value))}
              className="w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3">
              {[2, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <p className="text-sm text-muted">Catches a tag that fires twice, or a dose you already logged.</p>
          </div>
          <p className="text-sm text-muted">You can change these at any time.</p>
        </Card>
      )}
      <Card>
        <h2 className="text-lg font-semibold">Theme</h2>
        <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-3 gap-2">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              onClick={() => { setTheme(t); setT(t); }}
              className={`min-h-[48px] rounded-btn font-medium capitalize ${theme === t ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">Storage</h2>
        <p className="text-muted mt-1">Everything is saved on this device only.</p>
        <button onClick={check} className="mt-3 min-h-[48px] px-5 rounded-btn bg-surface-2 font-semibold">
          Keep my data safe from automatic clean-up
        </button>
        {persisted !== null && (
          <p className="mt-2 text-sm" role="status">
            {persisted ? '✓ Protected from automatic clean-up.' : 'Your browser did not grant this. Back up regularly.'}
          </p>
        )}
        {isIOS && isStandalone && (
          <p className="mt-2 text-sm text-caution">Tag taps open in Safari, which keeps separate data from this home-screen app.</p>
        )}
      </Card>
      <Card>
        <h2 className="text-lg font-semibold">About {APP_NAME}</h2>
        <p className="text-muted mt-1 text-sm">{DISCLAIMER}</p>
      </Card>
    </div>
  );
}
