import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Bell, Calculator, CalendarCheck, Check, ChevronRight, Clock, Download, Dumbbell, EyeOff, HardDriveDownload, HeartPulse, HelpCircle, Info, Lock, Nfc, Package, Palette, Pill, Plane, RefreshCw, Smile, Syringe, Timer, Users, Utensils, Watch, X, type LucideIcon } from 'lucide-react';
import { IconRow } from '../components/ui/Visual';
import { useSyncConfig } from '../app/sync';
import { setCheckInNotify, setDigestNotify, setRemindersEnabled, setTrainingReminders, syncReminders } from '../app/native';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sheet, SheetActions } from '../components/ui/Sheet';
import { Segmented, TextInput } from '../components/ui/Field';
import { Switch } from '../components/ui/Switch';
import { BARS, fromLoad, loadUnit } from '../logic/load';
import { getTheme, setTheme, type Theme } from '../app/theme';
import { APP_NAME } from '../config';
import { useFamily, useSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { go } from '../app/router';
import { DEFAULT_CHIPS, setSetting, type Units } from '../db/repos/settings';
import { eraseAll } from '../db/repos/backup';
import { fmtAgo, fmtHHmm } from '../logic/format';
import { hashPin, isValidPin, newSalt, verifyPin } from '../logic/pin';
import { useViewMode } from '../app/viewMode';
import { FamilyCard } from './Family';
import { placeName } from '../components/TravelBanner';
import { isNative, isNativeAndroid } from '../platform';
import { BUILD, checkForUpdate } from '../app/updates';
import { lockNow } from '../app/LockGate';
import { HAS_WATCH, HAS_MEDS, HAS_BODY, HAS_TRAINING, HAS_FOOD, FOCUS, PLAY, HAS_PEPTIDES, HAS_VISITS, edition, watchDownload } from '../edition';
import { SIDE_EFFECT_CHIPS } from '../logic/peptide';

const RemindersCard = lazy(() => import('./RemindersCard'));
const HealthCard = lazy(() => import('./HealthCard'));

/** Common with GLP-1s and other injections, for the dose-level table in Trends. */

const selectCls = 'w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3';

export type SettingsSection = 'reminders' | 'doses' | 'training' | 'checkins' | 'people' | 'health' | 'privacy' | 'display' | 'watch' | 'about';
export const SECTION_TITLE: Record<SettingsSection, string> = {
  reminders: 'Reminders', doses: 'Doses', training: 'Training', checkins: 'Check-ins', people: 'People and sync', health: 'Health data',
  privacy: 'Privacy', display: 'Display', watch: 'Watch', about: `About ${APP_NAME}`,
};

const restLabel = (x: number) => (x === 0 ? 'Off' : x % 60 ? `${Math.floor(x / 60) ? `${Math.floor(x / 60)} min ` : ''}${x % 60} s` : `${x / 60} min`);
const THEMES: [Theme, string][] = [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];

/** Settings: the features as switches, then one row per area, each opening a short page. */
export function Settings({ section }: { section?: string }) {
  const [theme, setT] = useState<Theme>(getTheme());
  const settings = useSettings();
  const sync = useSyncConfig();
  const now = useNow(60_000);
  const fam = useFamily();
  const toast = useToast();
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [newChip, setNewChip] = useState('');
  const [pinSheet, setPinSheet] = useState<false | 'main' | 'privacy'>(false);
  const priv = useViewMode() === 'private';
  const [eraseSheet, setEraseSheet] = useState(false);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    if (!navigator.storage?.persisted) { setPersisted(false); return; }
    navigator.storage.persisted().then(setPersisted).catch(() => setPersisted(false));
  }, []);

  if (!settings) return <div className="h-60 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />;
  const last = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : null;
  const notifyOff = () => toast('Notifications are off for this app in your phone’s settings');
  const addChip = () => {
    const c = newChip.trim();
    if (c && !settings.chips.includes(c)) setSetting('chips', [...settings.chips, c]);
    setNewChip('');
  };

  const pages: Record<SettingsSection, () => ReactNode> = {
    reminders: () => (
      <>
        <Suspense fallback={null}><RemindersCard enabled={settings.remindersEnabled} nudges={settings.lateNudges} /></Suspense>
        <Card className="space-y-2">
          <Switch label="Hide medicine names" checked={settings.discreetReminders} onChange={async (v) => { await setSetting('discreetReminders', v); void syncReminders(); }}>
            Reminders say only “Reminder” and the time
          </Switch>
          <Switch label="Weekly summary on Mondays" checked={settings.digestNotify} onChange={async (v) => { const on = await setDigestNotify(v); if (v && !on) notifyOff(); }} />
          <Switch label="Wear-off heads-up" checked={settings.wearOffNotify} onChange={async (v) => { await setSetting('wearOffNotify', v); void syncReminders(); }}>30 min before focus usually drops</Switch>
          {HAS_TRAINING && settings.trainingTools && (
            <Switch label="Training-day reminders" checked={settings.trainingReminders} onChange={async (v) => { const on = await setTrainingReminders(v); if (v && !on) notifyOff(); }}>
              30 min before you usually train
            </Switch>
          )}
        </Card>
      </>
    ),
    doses: () => (
      <Card className="space-y-5">
        <Pick id="day-start" label="Day starts at" hint="Earlier doses count for the day before">
          <input id="day-start" type="time" value={settings.dayStartsAt} required onChange={(e) => e.target.value && setSetting('dayStartsAt', e.target.value)} className={`${selectCls} tnum`} />
        </Pick>
        <Pick id="guard" label="Ask before logging twice within">
          <select id="guard" value={settings.guardMinutes} onChange={(e) => setSetting('guardMinutes', Number(e.target.value))} className={selectCls}>
            {[2, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
          </select>
        </Pick>
        <Pick id="time-mode" label="When travelling, dose times follow">
          <select id="time-mode" value={settings.timeMode} onChange={(e) => setSetting('timeMode', e.target.value as 'device' | 'home')} className={selectCls}>
            <option value="device">Local time</option>
            <option value="home">Home time{settings.homeTimeZone ? ` (${placeName(settings.homeTimeZone)})` : ''}</option>
          </select>
        </Pick>
        <Pick id="refill-warn" label="Warn before running out">
          <select id="refill-warn" value={settings.refillWarnDays} onChange={(e) => setSetting('refillWarnDays', Number(e.target.value))} className={selectCls}>
            {[3, 5, 7, 10, 14, 21].map((d) => <option key={d} value={d}>{d} days ahead</option>)}
          </select>
        </Pick>
        <div className="grid grid-cols-2 gap-3">
          <SettingText id="ph-name" label="Pharmacy" value={settings.pharmacyName} placeholder="Name" onSave={(v) => setSetting('pharmacyName', v)} />
          <SettingText id="ph-contact" label="Mobile or email" value={settings.pharmacyContact} placeholder="For repeat requests" onSave={(v) => setSetting('pharmacyContact', v)} />
        </div>
      </Card>
    ),
    training: () => (
      <Card className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <Pick id="rest" label="Rest timer">
            <select id="rest" value={settings.restSeconds} onChange={(e) => setSetting('restSeconds', Number(e.target.value))} className={selectCls}>
              {[0, 60, 90, 120, 150, 180, 240, 300].map((x) => <option key={x} value={x}>{restLabel(x)}</option>)}
            </select>
          </Pick>
          <Pick id="bar" label="Barbell">
            <select id="bar" value={String(BARS[settings.units].reduce((b, x) => (Math.abs(fromLoad(x, settings.units) - settings.barKg) < Math.abs(fromLoad(b, settings.units) - settings.barKg) ? x : b)))}
              onChange={(e) => setSetting('barKg', fromLoad(Number(e.target.value), settings.units))} className={selectCls}>
              {BARS[settings.units].map((x) => <option key={x} value={x}>{x} {loadUnit(settings.units)}</option>)}
            </select>
          </Pick>
        </div>
        <Switch label="Smart rest" checked={settings.smartRest} onChange={(v) => setSetting('smartRest', v)}>Longer after heavy sets</Switch>
        <Switch label="Adjust as I go" checked={settings.autoAdjust} onChange={(v) => setSetting('autoAdjust', v)}>Next sets up after easy ones, down after hard ones</Switch>
        <div className="grid grid-cols-2 gap-3">
          <TargetInput id="protein" label="Protein a day (g)" value={settings.proteinTargetG} onChange={(v) => setSetting('proteinTargetG', v)} />
          <TargetInput id="water" label="Water a day (mL)" value={settings.waterTargetMl} onChange={(v) => setSetting('waterTargetMl', v)} />
        </div>
      </Card>
    ),
    checkins: () => (
      <Card className="space-y-5">
        {HAS_MEDS && <Pick id="ci-delay" label="Ask how I feel after a dose">
          <select id="ci-delay" value={settings.checkInDelayMin} onChange={(e) => setSetting('checkInDelayMin', Number(e.target.value))} className={selectCls}>
            <option value={0}>Off</option>
            {[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : m === 90 ? '1½ hours' : `${m / 60} hour${m === 60 ? '' : 's'}`} later</option>)}
          </select>
        </Pick>}
        <div>
          <span className="block text-sm font-medium mb-2">Ask how the day went at</span>
          <ul className="flex flex-wrap gap-2">
            {settings.checkInTimes.map((t) => (
              <li key={t} className="flex items-center gap-1 pl-4 pr-1 min-h-[44px] rounded-chip bg-surface-2 text-sm tnum">
                {fmtHHmm(t)}
                <button onClick={() => setSetting('checkInTimes', settings.checkInTimes.filter((x) => x !== t))} aria-label={`Remove ${fmtHHmm(t)}`}
                  className="w-9 h-9 rounded-full flex items-center justify-center text-muted"><X size={16} aria-hidden="true" /></button>
              </li>
            ))}
            {settings.checkInTimes.length === 0 && <li className="text-sm text-muted min-h-[44px] flex items-center">No daily check-in</li>}
          </ul>
          {settings.checkInTimes.length < 4 && (
            <label className="flex items-center gap-3 mt-3 text-sm">
              <span>Add a time</span>
              <input type="time" aria-label="Add a daily check-in time" className={`${selectCls} max-w-[9rem]`}
                onChange={(e) => { const v = e.target.value; if (/^\d{2}:\d{2}$/.test(v) && !settings.checkInTimes.includes(v)) { void setSetting('checkInTimes', [...settings.checkInTimes, v].sort()); e.target.value = ''; } }} />
            </label>
          )}
        </div>
        <Switch label="Open the check-in by itself" checked={settings.checkInPopup} onChange={(v) => setSetting('checkInPopup', v)}>When one is due and the app is open, once each</Switch>
        {isNative && <Switch label="Check-in notifications" checked={settings.checkInNotify} onChange={async (v) => { const on = await setCheckInNotify(v); if (v && !on) notifyOff(); }}>{HAS_MEDS ? 'After a dose and at your daily times. They never name a medicine.' : 'At your daily times.'}</Switch>}
        <div>
          <span className="block text-sm font-medium mb-2">What you can tick</span>
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
              <input value={newChip} onChange={(e) => setNewChip(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addChip()} placeholder="Add one" className={selectCls} /></label>
            <Button variant="secondary" onClick={addChip} disabled={!newChip.trim()}>Add</Button>
          </div>
          {HAS_PEPTIDES && settings.peptideTools && SIDE_EFFECT_CHIPS.some((c) => !settings.chips.includes(c)) && (
            <Button variant="secondary" className="w-full mt-3" onClick={() => { setSetting('chips', [...settings.chips, ...SIDE_EFFECT_CHIPS.filter((c) => !settings.chips.includes(c))]); toast('Added'); }}>
              Add injection side effects
            </Button>
          )}
          <button onClick={async () => { const before = settings.chips; await setSetting('chips', DEFAULT_CHIPS); toast('Reset', { onAction: () => setSetting('chips', before) }); }}
            className="mt-2 min-h-[44px] text-sm text-primary font-semibold">Reset</button>
        </div>
      </Card>
    ),
    people: () => (
      <>
        <FamilyCard />
        <Row href="#/sync" Icon={RefreshCw} title="Family sync" value={!sync ? 'Off' : sync.lastSyncAt ? `Synced ${fmtAgo(now - Date.parse(sync.lastSyncAt))}` : 'On'} />
      </>
    ),
    health: () => (
      <Suspense fallback={null}><HealthCard on={settings.healthImport} last={settings.healthLastImport} personId={settings.healthImport ? settings.healthPersonId : settings.activePersonId}
        personName={fam?.many ? fam.nameOf(settings.healthImport ? settings.healthPersonId : settings.activePersonId) : undefined} now={now} /></Suspense>
    ),
    privacy: () => (
      <>
        <Card className="space-y-3">
          <h2 className="font-medium flex items-center gap-2"><Lock size={18} aria-hidden="true" /> App lock</h2>
          {settings.lockEnabled ? (
            <>
              <Pick id="lock-after" label="Lock">
                <select id="lock-after" value={settings.lockAfterMin} onChange={(e) => setSetting('lockAfterMin', Number(e.target.value))} className={selectCls}>
                  <option value={0}>When I leave the app</option>
                  {[1, 5, 15, 60].map((m) => <option key={m} value={m}>After {m === 60 ? '1 hour' : `${m} minute${m === 1 ? '' : 's'}`}</option>)}
                </select>
              </Pick>
              <Button variant="secondary" className="w-full flex items-center justify-center gap-2" onClick={lockNow}><Lock size={18} aria-hidden="true" /> Lock now</Button>
              {/* The private view can't change or turn off the lock (that would open the full view next time). */}
              {!priv && <Switch label="Ask for the PIN on every tag tap" checked={settings.tagNeedsPin} onChange={(v) => setSetting('tagNeedsPin', v)}>Even if you've just unlocked</Switch>}
              {!priv && (
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setPinSheet('main')}>Change PIN</Button>
                  <Button variant="secondary" onClick={async () => { await setSetting('lockEnabled', false); await setSetting('privacyPinHash', null); await setSetting('privacyPinSalt', null); toast('App lock off'); }}>Turn off</Button>
                </div>
              )}
            </>
          ) : <Button className="w-full" onClick={() => setPinSheet('main')}>Set a PIN</Button>}
        </Card>
        {settings.lockEnabled && !priv && (
          <Card className="space-y-3">
            <h2 className="font-medium flex items-center gap-2"><EyeOff size={18} aria-hidden="true" /> Private view</h2>
            <p className="text-sm">A second PIN that opens the app looking the same, with the medicines you choose under a cover name or left out{HAS_PEPTIDES ? ', and the peptide tools left out' : ''}. Choose for each medicine on its page.</p>
            {settings.privacyPinHash ? (
              <>
                {HAS_PEPTIDES && <Switch label="Leave out peptide tools" checked={settings.privacyHidePeptides} onChange={(v) => setSetting('privacyHidePeptides', v)} />}
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => setPinSheet('privacy')}>Change privacy PIN</Button>
                  <Button variant="secondary" onClick={async () => { await setSetting('privacyPinHash', null); await setSetting('privacyPinSalt', null); toast('Privacy PIN removed'); }}>Remove</Button>
                </div>
              </>
            ) : <Button variant="secondary" className="w-full" onClick={() => setPinSheet('privacy')}>Set a privacy PIN</Button>}
          </Card>
        )}
        <Card className="space-y-2">
          <h2 className="font-medium">Your data</h2>
          <p className="text-sm">{sync ? 'This phone, plus an encrypted copy on your family’s phones' : 'This phone only'}</p>
          {!isNative && !persisted && (
            <Button variant="secondary" className="w-full" onClick={async () => {
              let ok = false;
              try { ok = (await navigator.storage?.persist?.()) ?? false; } catch { ok = false; }
              setPersisted(ok);
              toast(ok ? 'This browser will keep your data' : `Not this time. Installing ${APP_NAME} and keeping backups helps.`);
            }}>Ask the browser to keep it</Button>
          )}
        </Card>
      </>
    ),
    display: () => (
      <Card className="space-y-5">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium">Theme</span>
          <Segmented<Theme> label="Theme" value={theme} onChange={(t) => { setTheme(t); setT(t); }} options={THEMES.map(([value, label]) => ({ value, label }))} />
        </div>
        {HAS_BODY && (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Units</span>
            <Segmented<Units> label="Units" value={settings.units} onChange={(v) => setSetting('units', v)}
              options={[{ value: 'metric', label: 'kg, cm' }, { value: 'imperial', label: 'lb, in' }]} />
          </div>
        )}
      </Card>
    ),
    watch: () => (
      <Card className="space-y-3">
        <ul className="space-y-1">
          <li><IconRow Icon={Clock} tone="primary">Next dose: app, tile and watch face</IconRow></li>
          <li><IconRow Icon={Check} tone="primary">Log with one tap</IconRow></li>
          {HAS_TRAINING && <li><IconRow Icon={Timer} tone="primary">Workouts: next set, Done, rest timer</IconRow></li>}
        </ul>
        <a href={watchDownload} className="flex items-center justify-center gap-2 min-h-[48px] rounded-btn bg-primary text-on-primary font-semibold"><Download size={18} aria-hidden="true" /> {edition.watchApk}</a>
        <details className="text-sm">
          <summary className="cursor-pointer min-h-[44px] flex items-center font-medium">Install steps</summary>
          <ol className="list-decimal pl-5 space-y-1 text-muted">
            <li>Watch: Settings → System → About → tap Build number 7 times.</li>
            <li>Developer options: turn on ADB and Wireless debugging.</li>
            <li>From a computer on the same Wi-Fi: <code>adb install {edition.watchApk}</code></li>
            <li>Open {APP_NAME} on this phone once.</li>
          </ol>
        </details>
      </Card>
    ),
    about: () => (
      <>
        <Card className="space-y-3">
          <p className="text-[15px]">{APP_NAME} keeps everything on this {isNative ? 'phone' : 'device'}. There's no account, and nothing is sent anywhere unless you turn on sync or make a backup{HAS_FOOD ? ' (a food barcode you scan is looked up by its number alone)' : ''}.</p>
          <p className="text-sm text-muted tnum">{BUILD > 0 ? `Build ${BUILD}` : 'Web version'}</p>
          {isNativeAndroid && BUILD > 0 && !PLAY && (
            <>
              <Switch label="Check for updates" checked={settings.updateCheck} onChange={(v) => setSetting('updateCheck', v)}>Once a day</Switch>
              <Button variant="secondary" onClick={async () => { const u = await checkForUpdate(true); toast(u ? `Build ${u.build} is ready on Today` : 'Up to date'); if (u) await setSetting('updateDismissed', 0); }}>Check now</Button>
            </>
          )}
        </Card>
        <Card className="space-y-1">
          <a href="#/help" className="min-h-[48px] flex items-center justify-between font-medium">Help and guides<ChevronRight size={18} className="text-muted" aria-hidden="true" /></a>
          {!priv && <a href="#/welcome" className="min-h-[48px] flex items-center justify-between font-medium border-t border-border">Show the welcome again<ChevronRight size={18} className="text-muted" aria-hidden="true" /></a>}
        </Card>
        <Card>
          <Button variant="danger" className="w-full" onClick={() => { setTyped(''); setEraseSheet(true); }}>Erase all data</Button>
        </Card>
      </>
    ),
  };

  // Pages an app doesn't have (TapWeigh and TapLift: doses and dose reminders; training where it's not built in) show
  // the main list instead.
  const absent: SettingsSection[] = [...(HAS_MEDS ? [] : ['doses', 'reminders'] as const), ...(HAS_TRAINING ? [] : ['training'] as const)];
  const sec = section && !absent.includes(section as SettingsSection) ? section as SettingsSection : undefined;
  const body = sec && pages[sec] ? <div className="space-y-4">{pages[sec]()}</div> : (
    <div className="space-y-6">
      <section aria-label="Features" className="space-y-1">
        <h2 className="text-sm font-medium text-muted mb-1">Features</h2>
        {HAS_PEPTIDES && !priv && <Toggle Icon={Syringe} label="Peptides and injections" checked={settings.peptideTools} onChange={(v) => setSetting('peptideTools', v)} />}
        {HAS_TRAINING && FOCUS !== 'training' && <Toggle Icon={Dumbbell} label="Training" checked={settings.trainingTools} onChange={(v) => setSetting('trainingTools', v)} />}
        {HAS_FOOD && FOCUS !== 'weight' && <Toggle Icon={Utensils} label="Food" checked={settings.foodTracking} onChange={(v) => setSetting('foodTracking', v)} />}
        {isNative && <Toggle Icon={Bell} label="Dose reminders" checked={settings.remindersEnabled} onChange={async (v) => { const on = await setRemindersEnabled(v); if (v && !on) notifyOff(); }} />}
      </section>
      <section aria-label="Settings">
        {isNative && <Row href="#/settings/reminders" Icon={Bell} title="Reminders" value={settings.remindersEnabled ? 'On' : 'Off'} />}
        {HAS_MEDS && <Row href="#/settings/doses" Icon={Pill} title="Doses" value={`Day starts ${fmtHHmm(settings.dayStartsAt)}`} />}
        {HAS_TRAINING && settings.trainingTools && <Row href="#/settings/training" Icon={Dumbbell} title="Training" value={`Rest ${restLabel(settings.restSeconds)}`} />}
        <Row href="#/settings/checkins" Icon={Smile} title="Check-ins" value={[HAS_MEDS && settings.checkInDelayMin ? 'after doses' : null, settings.checkInTimes.length ? settings.checkInTimes.map(fmtHHmm).join(', ') : null].filter(Boolean).join(' · ').replace(/^./, (c) => c.toUpperCase()) || 'Off'} />
        <Row href="#/settings/people" Icon={Users} title="People and sync" value={`${fam?.people.length ?? 1} ${fam && fam.people.length > 1 ? 'people' : 'person'} · sync ${sync ? 'on' : 'off'}`} />
        {isNative && <Row href="#/settings/health" Icon={HeartPulse} title="Health data" value={settings.healthImport ? 'On' : 'Off'} />}
        <Row href="#/backup" Icon={HardDriveDownload} title="Backup and restore" value={last ? fmtAgo(now - last) : 'None yet'} />
        <Row href="#/settings/privacy" Icon={Lock} title="Privacy" value={settings.lockEnabled ? 'PIN on' : 'PIN off'} />
        <Row href="#/settings/display" Icon={Palette} title="Display" value={THEMES.find(([t]) => t === theme)?.[1] ?? ''} />
        {isNativeAndroid && HAS_WATCH && <Row href="#/settings/watch" Icon={Watch} title="Watch" value="Wear OS" />}
      </section>
      <section aria-label="Tools">
        <h2 className="text-sm font-medium text-muted mb-1">Tools</h2>
        <Row href="#/tags" Icon={Nfc} title="Tags" />
        {HAS_MEDS && <Row href={HAS_VISITS ? '#/appointments' : '#/labs'} Icon={CalendarCheck} title={HAS_VISITS ? 'Appointments and lab results' : 'Lab results'} />}
        {HAS_VISITS && <Row href="#/travel" Icon={Plane} title="Plan a trip" />}
        {HAS_PEPTIDES && settings.peptideTools && <Row href="#/calc" Icon={Calculator} title="Peptide calculator" />}
        {HAS_PEPTIDES && settings.peptideTools && <Row href="#/supplies" Icon={Package} title="Supplies" />}
        <Row href="#/help" Icon={HelpCircle} title="Help" />
        <Row href="#/settings/about" Icon={Info} title={`About ${APP_NAME}`} value={BUILD ? `Build ${BUILD}` : undefined} />
      </section>
    </div>
  );

  return (
    <>
      {body}
      <PinSheet open={!!pinSheet} kind={pinSheet || 'main'} onClose={() => setPinSheet(false)} />
      <Sheet open={eraseSheet} onClose={() => setEraseSheet(false)} title="Erase all data?">
        <div className="space-y-4">
          <p>Removes everything on this phone. It can't be undone.</p>
          <Button className="w-full" onClick={() => { setEraseSheet(false); go('/backup'); }}>Back up first</Button>
          <TextInput label="Type ERASE to confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" />
          <SheetActions>
            <Button variant="danger" className="w-full min-h-[56px]" disabled={typed.trim() !== 'ERASE'}
              onClick={async () => { await eraseAll(); window.location.replace(window.location.pathname); }}>Erase everything</Button>
          </SheetActions>
        </div>
      </Sheet>
    </>
  );
}

/** A labelled control with an optional few-word hint under it. */
function Pick({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** A feature switch with its icon: one line. */
function Toggle({ Icon, label, checked, onChange }: { Icon: LucideIcon; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 border-t border-border first-of-type:border-t-0">
      <span aria-hidden="true" className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center shrink-0"><Icon size={18} /></span>
      <div className="flex-1"><Switch label={label} checked={checked} onChange={onChange} /></div>
    </div>
  );
}

/** A row that opens a page, with its current value on the right. */
function Row({ href, Icon, title, value }: { href: string; Icon: LucideIcon; title: string; value?: string }) {
  return (
    <a href={href} className="border-t border-border min-h-[56px] flex items-center gap-3">
      <span aria-hidden="true" className="w-9 h-9 rounded-full bg-surface-2 flex items-center justify-center shrink-0"><Icon size={18} /></span>
      <span className="flex-1 font-medium">{title}</span>
      {value && <span className="text-sm text-muted tnum truncate max-w-[45%]">{value}</span>}
      <ChevronRight className="text-muted shrink-0" size={18} aria-hidden="true" />
    </a>
  );
}

function SettingText({ id, label, value, placeholder, onSave }: { id: string; label: string; value: string; placeholder?: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input id={id} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => text.trim() !== value && onSave(text.trim())} className={selectCls} autoComplete="off" />
    </div>
  );
}

function TargetInput({ id, label, value, onChange }: { id: string; label: string; value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input id={id} type="number" inputMode="numeric" min="0" step="1" value={text} placeholder="None"
        onChange={(e) => setText(e.target.value)} onBlur={() => { const n = Number(text); onChange(text.trim() && n > 0 ? Math.round(n) : null); }}
        className={`${selectCls} tnum`} />
    </div>
  );
}

function PinSheet({ open, kind, onClose }: { open: boolean; kind: 'main' | 'privacy'; onClose: () => void }) {
  const toast = useToast();
  const settings = useSettings();
  const [clash, setClash] = useState(false);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [tried, setTried] = useState(false);
  useEffect(() => { if (open) { setPin(''); setConfirm(''); setTried(false); } }, [open]);

  // The privacy PIN has the main PIN's length (the pad unlocks at that length) and must differ from it.
  const len = settings?.pinLength ?? 4;
  const err = kind === 'privacy' && pin.length !== len ? `Use ${len} digits, like your PIN.` : !isValidPin(pin) ? 'Use 4 to 6 digits.'
    : pin !== confirm ? "The PINs don't match." : clash ? (kind === 'privacy' ? 'Use a different PIN from your main one.' : "That's your privacy PIN. Use a different one.") : '';
  useEffect(() => { setClash(false); }, [pin]);
  const save = async () => {
    setTried(true);
    if (err || !settings) return;
    const other = kind === 'privacy' ? [settings.pinSalt, settings.pinHash] : [settings.privacyPinSalt, settings.privacyPinHash];
    if (other[0] && other[1] && await verifyPin(pin, other[0], other[1])) { setClash(true); return; }
    const salt = newSalt();
    if (kind === 'privacy') {
      await setSetting('privacyPinSalt', salt);
      await setSetting('privacyPinHash', await hashPin(pin, salt));
      toast('Privacy PIN set');
      onClose();
      return;
    }
    await setSetting('pinSalt', salt);
    await setSetting('pinHash', await hashPin(pin, salt));
    // A new length would make the privacy PIN unusable on the pad, so it has to be set again.
    if (settings.privacyPinHash && pin.length !== settings.pinLength) { await setSetting('privacyPinHash', null); await setSetting('privacyPinSalt', null); }
    await setSetting('pinLength', pin.length);
    await setSetting('lockEnabled', true);
    toast(settings.privacyPinHash && pin.length !== settings.pinLength ? 'PIN changed. Set your privacy PIN again.' : 'App lock is on');
    onClose();
  };
  const pinProps = { type: 'password', inputMode: 'numeric' as const, pattern: '[0-9]*', maxLength: 6, autoComplete: 'off' };
  return (
    <Sheet open={open} onClose={onClose} title={kind === 'privacy' ? 'Set a privacy PIN' : 'Set a PIN'}>
      <div className="space-y-4">
        <TextInput label={kind === 'privacy' ? `Privacy PIN (${len} digits)` : 'New PIN (4 to 6 digits)'} {...pinProps} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoFocus />
        <TextInput label="Enter it again" {...pinProps} value={confirm} onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ''))} error={tried ? err : undefined} />
        <p className="text-sm text-muted">{kind === 'privacy' ? 'Enter it on the lock screen instead of your PIN to open the private view.' : 'Forgot it? Only erasing and restoring a backup gets you back in.'}</p>
        <SheetActions>
          <Button className="w-full min-h-[56px]" onClick={save}>{kind === 'privacy' ? 'Save privacy PIN' : 'Turn on app lock'}</Button>
        </SheetActions>
      </div>
    </Sheet>
  );
}
