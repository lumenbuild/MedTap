import { useEffect, useState } from 'react';
import { ChevronRight, HardDriveDownload, HelpCircle, Lock, X } from 'lucide-react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { Segmented, TextInput } from '../components/ui/Field';
import { getTheme, setTheme, type Theme } from '../app/theme';
import { APP_NAME, DISCLAIMER } from '../config';
import { useSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { go } from '../app/router';
import { DEFAULT_CHIPS, setSetting, type Units } from '../db/repos/settings';
import { eraseAll } from '../db/repos/backup';
import { fmtAgo, fmtHHmm } from '../logic/format';
import { hashPin, isValidPin, newSalt } from '../logic/pin';

const selectCls = 'w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3';

export function Settings() {
  const [theme, setT] = useState<Theme>(getTheme());
  const settings = useSettings();
  const now = useNow(60_000);
  const toast = useToast();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [newChip, setNewChip] = useState('');
  const [pinSheet, setPinSheet] = useState(false);
  const [eraseSheet, setEraseSheet] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(false)); }, []);
  const requestPersist = async () => setPersisted((await navigator.storage?.persist?.()) ?? false);

  if (!settings) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : null;

  const addChip = () => {
    const c = newChip.trim();
    if (c && !settings.chips.includes(c)) setSetting('chips', [...settings.chips, c]);
    setNewChip('');
  };

  return (
    <div className="space-y-4">
      <a href="#/backup" className="bg-surface rounded-card shadow-card p-5 flex items-center gap-3">
        <HardDriveDownload className="text-primary" aria-hidden="true" />
        <span className="flex-1">
          <span className="block font-semibold">Backup and restore</span>
          <span className="block text-sm text-muted tnum">{last ? `Last backup ${fmtAgo(now - last)}` : 'No backup yet'}</span>
        </span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Your day</h2>
        <div className="space-y-1.5">
          <label htmlFor="day-start" className="block text-sm font-medium">Day starts at</label>
          <input id="day-start" type="time" value={settings.dayStartsAt} required
            onChange={(e) => e.target.value && setSetting('dayStartsAt', e.target.value)}
            className={`${selectCls} tnum`} />
          <p className="text-sm text-muted">
            Doses before {fmtHHmm(settings.dayStartsAt)} count towards the day before, so a late-night dose stays with the right day.
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="guard" className="block text-sm font-medium">Ask before logging twice within</label>
          <select id="guard" value={settings.guardMinutes} onChange={(e) => setSetting('guardMinutes', Number(e.target.value))} className={selectCls}>
            {[2, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
          <p className="text-sm text-muted">Catches a tag that fires twice, or a dose you already logged.</p>
        </div>
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Units</span>
          <Segmented<Units> label="Units" value={settings.units} onChange={(v) => setSetting('units', v)}
            options={[{ value: 'metric', label: 'kg and cm' }, { value: 'imperial', label: 'lb and in' }]} />
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="text-lg font-semibold">Check-ins</h2>
        <div className="space-y-1.5">
          <label htmlFor="ci-delay" className="block text-sm font-medium">Suggest a check-in after a dose</label>
          <select id="ci-delay" value={settings.checkInDelayMin} onChange={(e) => setSetting('checkInDelayMin', Number(e.target.value))} className={selectCls}>
            <option value={0}>Off</option>
            {[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`} later</option>)}
          </select>
          <p className="text-sm text-muted">Shows a card on Today. {APP_NAME} can't send notifications.</p>
        </div>
        <div>
          <span className="block text-sm font-medium mb-2">“What are you noticing?” options</span>
          <ul className="flex flex-wrap gap-2">
            {settings.chips.map((c) => (
              <li key={c} className="flex items-center gap-1 pl-4 pr-1 min-h-[44px] rounded-chip bg-surface-2 text-sm">
                {c}
                <button onClick={() => setSetting('chips', settings.chips.filter((x) => x !== c))} aria-label={`Remove ${c}`}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-muted"><X size={16} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 mt-3">
            <label className="flex-1"><span className="sr-only">New option</span>
              <input value={newChip} onChange={(e) => setNewChip(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addChip()}
                placeholder="Add an option" className={selectCls} /></label>
            <Button variant="secondary" onClick={addChip} disabled={!newChip.trim()}>Add</Button>
          </div>
          <button onClick={() => setSetting('chips', DEFAULT_CHIPS)} className="mt-2 min-h-[44px] text-sm text-primary font-semibold">Reset to the defaults</button>
        </div>
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2"><Lock size={18} aria-hidden="true" /> App lock</h2>
        <p className="text-sm text-muted">This is a privacy screen. It stops casual access on an unlocked phone. Backups are not encrypted.</p>
        {settings.lockEnabled ? (
          <>
            <div className="space-y-1.5">
              <label htmlFor="lock-after" className="block text-sm font-medium">Lock</label>
              <select id="lock-after" value={settings.lockAfterMin} onChange={(e) => setSetting('lockAfterMin', Number(e.target.value))} className={selectCls}>
                <option value={0}>As soon as I leave the app</option>
                {[1, 5, 15, 60].map((m) => <option key={m} value={m}>After {m === 60 ? '1 hour' : `${m} minute${m === 1 ? '' : 's'}`} away or idle</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setPinSheet(true)}>Change PIN</Button>
              <Button variant="secondary" onClick={async () => { await setSetting('lockEnabled', false); toast('App lock is off'); }}>Turn off</Button>
            </div>
          </>
        ) : (
          <Button className="w-full" onClick={() => setPinSheet(true)}>Set a PIN</Button>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Storage</h2>
        <p className="text-sm">Everything is saved on this device only.</p>
        {persisted ? (
          <p className="text-sm text-success font-medium" role="status">✓ Protected from automatic clean-up.</p>
        ) : (
          <>
            <p className="text-sm text-muted" role="status">
              {persisted === false ? 'Your browser may clear this data if the phone runs low on space. Regular use and backups keep it safe.' : 'Checking…'}
            </p>
            <Button variant="secondary" className="w-full" onClick={requestPersist}>Ask to keep my data</Button>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">Theme</h2>
        <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-3 gap-2">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} role="radio" aria-checked={theme === t} onClick={() => { setTheme(t); setT(t); }}
              className={`min-h-[48px] rounded-btn font-medium capitalize ${theme === t ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>
              {t}
            </button>
          ))}
        </div>
      </Card>

      <a href="#/help" className="bg-surface rounded-card shadow-card p-5 flex items-center gap-3">
        <HelpCircle className="text-primary" aria-hidden="true" />
        <span className="flex-1 font-semibold">Help, privacy and tag guide</span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>

      <Card>
        <h2 className="text-lg font-semibold">About {APP_NAME}</h2>
        <p className="text-muted mt-1 text-sm">{DISCLAIMER}</p>
      </Card>

      <Card className="space-y-2">
        <Button variant="danger" className="w-full" onClick={() => { setTyped(''); setEraseSheet(true); }}>Erase all data</Button>
      </Card>

      <PinSheet open={pinSheet} onClose={() => setPinSheet(false)} />

      <Sheet open={eraseSheet} onClose={() => setEraseSheet(false)} title="Erase all data?">
        <div className="space-y-4">
          <p>This removes every medication, dose, check-in, body entry, photo and tag link from this phone. It can't be undone.</p>
          <Button className="w-full" onClick={() => { setEraseSheet(false); go('/backup'); }}>Back up first</Button>
          <TextInput label="Type ERASE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
          <Button variant="danger" className="w-full min-h-[56px]" disabled={typed.trim() !== 'ERASE'}
            onClick={async () => { await eraseAll(); window.location.replace(window.location.pathname); }}>Erase everything</Button>
        </div>
      </Sheet>
    </div>
  );
}

function PinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setPin(''); setConfirm(''); setTried(false); } }, [open]);

  const err = !isValidPin(pin) ? 'Use 4 to 6 digits.' : pin !== confirm ? "The PINs don't match." : '';
  const save = async () => {
    setTried(true);
    if (err) return;
    const salt = newSalt();
    await setSetting('pinSalt', salt);
    await setSetting('pinHash', await hashPin(pin, salt));
    await setSetting('pinLength', pin.length);
    await setSetting('lockEnabled', true);
    toast('App lock is on');
    onClose();
  };
  const pinProps = { type: 'password', inputMode: 'numeric' as const, pattern: '[0-9]*', maxLength: 6, autoComplete: 'off' };
  return (
    <Sheet open={open} onClose={onClose} title="Set a PIN">
      <div className="space-y-4">
        <TextInput label="New PIN (4 to 6 digits)" {...pinProps} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
        <TextInput label="Enter it again" {...pinProps} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} error={tried ? err : undefined} />
        <p className="text-sm text-muted">If you forget it, the only way back in is to erase this phone's data and restore a backup.</p>
        <Button className="w-full min-h-[56px]" onClick={save}>Turn on app lock</Button>
      </div>
    </Sheet>
  );
}
