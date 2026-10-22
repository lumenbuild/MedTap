import { lazy, Suspense, useEffect, useState } from 'react';
import { Calculator, ChevronRight, Package, HardDriveDownload, HelpCircle, Lock, RefreshCw, Syringe, X } from 'lucide-react';
import { useSyncConfig } from '../app/sync';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sheet, SheetActions } from '../components/ui/Sheet';
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
import { FamilyCard } from './Family';
import { placeName } from '../components/TravelBanner';
import { isAndroid, isIOS, isNative, isStandalone } from '../platform';
import { HAS_BODY, HAS_PEPTIDES } from '../edition';
import { SIDE_EFFECT_CHIPS } from '../logic/peptide';

const RemindersCard = lazy(() => import('./RemindersCard'));

/** Common with GLP-1s and other injections, for the dose-level table in Trends. */

const selectCls = 'w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3';

export function Settings() {
  const [theme, setT] = useState<Theme>(getTheme());
  const settings = useSettings();
  const sync = useSyncConfig();
  const now = useNow(60_000);
  const toast = useToast();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  /** The browser was asked on this screen and said no (browsers decide silently; there's no prompt). */
  const [refused, setRefused] = useState(false);
  const [newChip, setNewChip] = useState('');
  const [pinSheet, setPinSheet] = useState(false);
  const [eraseSheet, setEraseSheet] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!navigator.storage?.persisted) { setPersisted(false); return; }
    navigator.storage.persisted().then(setPersisted).catch(() => setPersisted(false));
  }, []);
  const requestPersist = async () => {
    let ok = false;
    try { ok = (await navigator.storage?.persist?.()) ?? false; } catch { ok = false; }
    setPersisted(ok);
    setRefused(!ok);
    toast(ok ? 'Done. This browser will keep your data.' : 'Your browser said no this time. See below for what helps.');
  };

  if (!settings) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : null;

  const addChip = () => {
    const c = newChip.trim();
    if (c && !settings.chips.includes(c)) setSetting('chips', [...settings.chips, c]);
    setNewChip('');
  };

  return (
    <div className="space-y-4">
      <a href="#/backup" className="border-t border-border py-4 flex items-center gap-3">
        <HardDriveDownload className="text-primary" aria-hidden="true" />
        <span className="flex-1">
          <span className="block font-semibold">Backup and restore</span>
          <span className="block text-sm text-muted tnum">{last ? `Last backup ${fmtAgo(now - last)}` : 'No backup yet'}</span>
        </span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>

      <FamilyCard />

      <a href="#/sync" className="border-t border-border py-4 flex items-center gap-3">
        <RefreshCw className="text-primary" aria-hidden="true" />
        <span className="flex-1">
          <span className="block font-semibold">Family sync</span>
          <span className="block text-sm text-muted tnum">
            {!sync ? 'Share records between phones' : sync.lastSyncAt ? `On · synced ${fmtAgo(now - Date.parse(sync.lastSyncAt))}` : 'On'}
          </span>
        </span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>

      {isNative && <Suspense fallback={null}><RemindersCard enabled={settings.remindersEnabled} /></Suspense>}

      <Card className="space-y-4">
        <h2 className="text-sm font-medium text-muted">Your day</h2>
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
          <label htmlFor="time-mode" className="block text-sm font-medium">When travelling, set times follow</label>
          <select id="time-mode" value={settings.timeMode} onChange={(e) => setSetting('timeMode', e.target.value as 'device' | 'home')} className={selectCls}>
            <option value="device">This phone's time zone</option>
            <option value="home">Home time{settings.homeTimeZone ? ` (${placeName(settings.homeTimeZone)})` : ''}</option>
          </select>
          <p className="text-sm text-muted">Every-few-hours countdowns always use real time passed, so they're unaffected.</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="refill-warn" className="block text-sm font-medium">Warn me before a medication runs out</label>
          <select id="refill-warn" value={settings.refillWarnDays} onChange={(e) => setSetting('refillWarnDays', Number(e.target.value))} className={selectCls}>
            {[3, 5, 7, 10, 14, 21].map((d) => <option key={d} value={d}>{d} days ahead</option>)}
          </select>
          <p className="text-sm text-muted">Worked out from your stock count and your schedule, including planned changes.</p>
        </div>
        {HAS_BODY && (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Units</span>
            <Segmented<Units> label="Units" value={settings.units} onChange={(v) => setSetting('units', v)}
              options={[{ value: 'metric', label: 'kg and cm' }, { value: 'imperial', label: 'lb and in' }]} />
          </div>
        )}
      </Card>

      {HAS_PEPTIDES && <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted flex items-center gap-2"><Syringe size={18} aria-hidden="true" /> Peptides and injections</h2>
        <label className="flex items-center justify-between gap-3 min-h-[48px]">
          <span>
            <span className="block font-medium">Peptide and injection tools</span>
            <span className="block text-sm text-muted">Vials you mix with water, syringe units for each dose, a calculator, titration plans, on/off cycles, supplies and level estimates.</span>
          </span>
          <input type="checkbox" role="switch" checked={settings.peptideTools} onChange={(e) => setSetting('peptideTools', e.target.checked)}
            className="w-6 h-6 accent-[var(--primary)] shrink-0" aria-label="Peptide and injection tools" />
        </label>
        {settings.peptideTools && (
          <a href="#/calc" className="min-h-[48px] flex items-center gap-3 px-3 rounded-btn bg-surface-2 font-medium">
            <Calculator size={20} className="text-primary" aria-hidden="true" /> <span className="flex-1">Peptide calculator</span> <ChevronRight className="text-muted" aria-hidden="true" />
          </a>
        )}
        {settings.peptideTools && SIDE_EFFECT_CHIPS.some((c) => !settings.chips.includes(c)) && (
          <button onClick={() => { setSetting('chips', [...settings.chips, ...SIDE_EFFECT_CHIPS.filter((c) => !settings.chips.includes(c))]); toast('Added to check-ins'); }}
            className="w-full min-h-[48px] px-3 rounded-btn bg-surface-2 font-medium text-left">
            Add injection side effects to check-ins <span className="block text-sm text-muted font-normal">{SIDE_EFFECT_CHIPS.join(', ')}</span>
          </button>
        )}
        {settings.peptideTools && (
          <a href="#/supplies" className="min-h-[48px] flex items-center gap-3 px-3 rounded-btn bg-surface-2 font-medium">
            <Package size={20} className="text-primary" aria-hidden="true" /> <span className="flex-1">Supplies</span> <ChevronRight className="text-muted" aria-hidden="true" />
          </a>
        )}
      </Card>}

      <Card className="space-y-4">
        <h2 className="text-sm font-medium text-muted">Check-ins</h2>
        <div className="space-y-1.5">
          <label htmlFor="ci-delay" className="block text-sm font-medium">Suggest a check-in after a dose</label>
          <select id="ci-delay" value={settings.checkInDelayMin} onChange={(e) => setSetting('checkInDelayMin', Number(e.target.value))} className={selectCls}>
            <option value={0}>Off</option>
            {[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`} later</option>)}
          </select>
          <p className="text-sm text-muted">Shows a card on Today.{isNative ? '' : ` ${APP_NAME} can't send notifications.`}</p>
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
        <h2 className="text-sm font-medium text-muted flex items-center gap-2"><Lock size={18} aria-hidden="true" /> App lock</h2>
        <p className="text-sm text-muted">This is a privacy screen. It stops casual access on an unlocked phone. It doesn't encrypt the data on the phone.</p>
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
        <h2 className="text-sm font-medium text-muted">Storage</h2>
        <p className="text-sm">Everything is saved on this device only.</p>
        {isNative ? (
          <p className="text-sm text-success font-medium" role="status">✓ Kept by the app. It's only removed if you uninstall {APP_NAME}.</p>
        ) : persisted ? (
          <p className="text-sm text-success font-medium" role="status">✓ Protected from automatic clean-up.</p>
        ) : (
          <>
            <p className="text-sm text-muted" role="status">
              {persisted === false ? 'Your browser may clear this data if the phone runs low on space. Regular use and backups keep it safe.' : 'Checking…'}
            </p>
            {refused && (
              <div className="text-sm rounded-btn bg-surface-2 p-3 space-y-2" role="status">
                <p className="font-medium">The browser decides this by itself; there's no prompt to accept.</p>
                {isIOS ? (
                  <p>Safari doesn't let websites keep data for sure. It can remove a website's data if you go 7 days of using Safari without opening it, so open {APP_NAME} at least every few days and keep a recent backup. The {APP_NAME} app doesn't have this limit.</p>
                ) : isAndroid ? (
                  <p>Chrome usually agrees once {APP_NAME} is installed{isStandalone ? '' : ' (Chrome menu → Install app)'} and used for a while. Try again in a few days.</p>
                ) : (
                  <p>Browsers usually agree once a site is bookmarked or installed and used regularly. Try again later.</p>
                )}
                <p>Either way, backups keep your data safe: <a href="#/backup" className="text-primary font-semibold">Backup and restore</a>.</p>
              </div>
            )}
            <Button variant="secondary" className="w-full" onClick={requestPersist}>{refused ? 'Ask again' : 'Ask to keep my data'}</Button>
          </>
        )}
      </Card>

      <Card>
        <h2 className="text-sm font-medium text-muted">Theme</h2>
        <div role="radiogroup" aria-label="Theme" className="mt-3 grid grid-cols-3 gap-2">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} role="radio" aria-checked={theme === t} onClick={() => { setTheme(t); setT(t); }}
              className={`min-h-[48px] rounded-btn font-medium capitalize ${theme === t ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>
              {t}
            </button>
          ))}
        </div>
      </Card>

      <a href="#/help" className="border-t border-border py-4 flex items-center gap-3">
        <HelpCircle className="text-primary" aria-hidden="true" />
        <span className="flex-1 font-semibold">Help, privacy and tag guide</span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>

      <Card>
        <h2 className="text-sm font-medium text-muted">About {APP_NAME}</h2>
        <p className="text-muted mt-1 text-sm">{DISCLAIMER}</p>
      </Card>

      <Card className="space-y-2">
        <Button variant="danger" className="w-full" onClick={() => { setTyped(''); setEraseSheet(true); }}>Erase all data</Button>
      </Card>

      <PinSheet open={pinSheet} onClose={() => setPinSheet(false)} />

      <Sheet open={eraseSheet} onClose={() => setEraseSheet(false)} title="Erase all data?">
        <div className="space-y-4">
          <p>This removes every medication, dose, check-in, {HAS_BODY ? 'body entry, photo' : 'blood pressure reading'} and tag link from this phone. It can't be undone.</p>
          <Button className="w-full" onClick={() => { setEraseSheet(false); go('/backup'); }}>Back up first</Button>
          <TextInput label="Type ERASE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
          <SheetActions>
            <Button variant="danger" className="w-full min-h-[56px]" disabled={typed.trim() !== 'ERASE'}
              onClick={async () => { await eraseAll(); window.location.replace(window.location.pathname); }}>Erase everything</Button>
          </SheetActions>
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
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={save}>Turn on app lock</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}
