import { useState } from 'react';
import { Card } from '../components/ui/Card';
import { getTheme, setTheme, type Theme } from '../app/theme';
import { APP_NAME, DISCLAIMER } from '../config';
import { isIOS, isStandalone } from '../platform';

export function Settings() {
  const [theme, setT] = useState<Theme>(getTheme());
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const check = async () => setPersisted((await navigator.storage?.persist?.()) ?? false);

  return (
    <div className="space-y-4">
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
