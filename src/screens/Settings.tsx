import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Calculator, CalendarCheck, ChevronRight, Package, HardDriveDownload, HelpCircle, Lock, Plane, RefreshCw, Nfc, X } from 'lucide-react';
import { useSyncConfig } from '../app/sync';
import { setDigestNotify, setTrainingReminders } from '../app/native';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Sheet, SheetActions } from '../components/ui/Sheet';
import { Segmented, TextInput } from '../components/ui/Field';
import { Switch } from '../components/ui/Switch';
import { BARS, fromLoad, loadUnit } from '../logic/load';
import { getTheme, setTheme, type Theme } from '../app/theme';
import { APP_NAME, DISCLAIMER } from '../config';
import { useFamily, useSettings } from '../app/data';
import { useNow } from '../app/useNow';
import { useToast } from '../app/toast';
import { go } from '../app/router';
import { DEFAULT_CHIPS, setSetting, type Units } from '../db/repos/settings';
import { eraseAll } from '../db/repos/backup';
import { fmtAgo, fmtHHmm } from '../logic/format';
import { hashPin, isValidPin, newSalt } from '../logic/pin';
import { FamilyCard } from './Family';
import { placeName } from '../components/TravelBanner';
import { isAndroid, isIOS, isNative, isNativeAndroid, isStandalone } from '../platform';
import { BUILD, checkForUpdate } from '../app/updates';
import { HAS_BODY, HAS_PEPTIDES, HAS_VISITS, edition, watchDownload } from '../edition';
import { SIDE_EFFECT_CHIPS } from '../logic/peptide';

const RemindersCard = lazy(() => import('./RemindersCard'));
const HealthCard = lazy(() => import('./HealthCard'));

/** Common with GLP-1s and other injections, for the dose-level table in Trends. */

const selectCls = 'w-full min-h-[48px] rounded-btn bg-surface-2 border border-border px-3';

export function Settings() {
  const [theme, setT] = useState<Theme>(getTheme());
  const settings = useSettings();
  const sync = useSyncConfig();
  const now = useNow(60_000);
  const fam = useFamily();
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

  const resetChips = async () => {
    const before = settings.chips;
    await setSetting('chips', DEFAULT_CHIPS);
    toast('Options reset to the defaults', { onAction: () => setSetting('chips', before) });
  };
  const travelHint = settings.timeMode === 'home'
    ? `An 8:00 am dose stays at 8:00 am ${settings.homeTimeZone ? placeName(settings.homeTimeZone) : 'home'} time, whatever the local time is.`
    : 'An 8:00 am dose stays at 8:00 am wherever you are.';

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">Changes save as you make them. Turning a feature off only hides it; nothing is deleted.</p>

      <a href="#/backup" className="border-t border-border py-4 flex items-center gap-3">
        <HardDriveDownload className="text-primary" aria-hidden="true" />
        <span className="flex-1">
          <span className="block font-semibold">Backup and restore</span>
          <span className="block text-sm text-muted tnum">{last ? `Last backup ${fmtAgo(now - last)}` : 'No backup yet'}</span>
        </span>
        <ChevronRight className="text-muted" aria-hidden="true" />
      </a>

      <Group title="People and phones">
        <FamilyCard />
        <a href="#/sync" className="border-t border-border py-4 flex items-center gap-3">
          <RefreshCw className="text-primary" aria-hidden="true" />
          <span className="flex-1">
            <span className="block font-semibold">Family sync</span>
            <span className="block text-sm text-muted tnum">
              {!sync ? 'Off · keep records the same on your family’s phones' : sync.lastSyncAt ? `On · synced ${fmtAgo(now - Date.parse(sync.lastSyncAt))}` : 'On'}
            </span>
          </span>
          <ChevronRight className="text-muted" aria-hidden="true" />
        </a>
      </Group>

      {isNative && (
        <Group title="Reminders and health data">
          <Suspense fallback={null}><RemindersCard enabled={settings.remindersEnabled} nudges={settings.lateNudges} /></Suspense>
          <Suspense fallback={null}><HealthCard on={settings.healthImport} last={settings.healthLastImport} personId={settings.healthImport ? settings.healthPersonId : settings.activePersonId}
            personName={fam?.many ? fam.nameOf(settings.healthImport ? settings.healthPersonId : settings.activePersonId) : undefined} now={now} /></Suspense>
          <Card>
            <Switch label="Your week, each Monday" checked={settings.digestNotify} onChange={async (v) => { const on = await setDigestNotify(v); if (v && !on) toast('Notifications are off for this app. Turn them on in your phone’s settings.'); }}>
              A notification at 8:30 am on Mondays. Today shows last week against the week before (doses, {HAS_BODY ? 'weight, training, ' : ''}sleep and mood) from Monday to Wednesday either way.
            </Switch>
          </Card>
        </Group>
      )}

      <Group title="Doses and schedules">
        <Card className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="day-start" className="block text-sm font-medium">My day starts at</label>
            <input id="day-start" type="time" value={settings.dayStartsAt} required
              onChange={(e) => e.target.value && setSetting('dayStartsAt', e.target.value)}
              className={`${selectCls} tnum`} />
            <p className="text-sm text-muted">
              Doses before {fmtHHmm(settings.dayStartsAt)} count as the day before, so a dose after midnight stays with that day. Today, streaks and charts all use this.
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="guard" className="block text-sm font-medium">Check with me if the same medication is logged twice within</label>
            <select id="guard" value={settings.guardMinutes} onChange={(e) => setSetting('guardMinutes', Number(e.target.value))} className={selectCls}>
              {[2, 5, 10, 15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
            <p className="text-sm text-muted">Catches a tag that reads twice, or a dose someone already logged. You can still log it.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="time-mode" className="block text-sm font-medium">When I change time zone, dose times follow</label>
            <select id="time-mode" value={settings.timeMode} onChange={(e) => setSetting('timeMode', e.target.value as 'device' | 'home')} className={selectCls}>
              <option value="device">Local time where I am</option>
              <option value="home">Home time{settings.homeTimeZone ? ` (${placeName(settings.homeTimeZone)})` : ''}</option>
            </select>
            <p className="text-sm text-muted">{travelHint} Every-few-hours medications count real hours, so they aren’t affected.</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="refill-warn" className="block text-sm font-medium">Warn me before a medication runs out</label>
            <select id="refill-warn" value={settings.refillWarnDays} onChange={(e) => setSetting('refillWarnDays', Number(e.target.value))} className={selectCls}>
              {[3, 5, 7, 10, 14, 21].map((d) => <option key={d} value={d}>{d} days ahead</option>)}
            </select>
            <p className="text-sm text-muted">A card on Today, worked out from the stock count and schedule on each medication, including planned changes.</p>
          </div>
          <div className="space-y-1.5">
            <div className="grid grid-cols-2 gap-3">
              <SettingText id="ph-name" label="Your pharmacy (optional)" value={settings.pharmacyName} placeholder="e.g. Main St Pharmacy" onSave={(v) => setSetting('pharmacyName', v)} />
              <SettingText id="ph-contact" label="Its mobile or email" value={settings.pharmacyContact} placeholder="0400 000 000" onSave={(v) => setSetting('pharmacyContact', v)} />
            </div>
            <p className="text-sm text-muted">Then “Ask the pharmacy” on a refill card writes a repeat request ready to send. Nothing is sent until you press send.</p>
          </div>
        </Card>
      </Group>

      <Group title="Optional features">
        <Card className="space-y-4">
          {HAS_PEPTIDES && (
            <Switch label="Peptides and injections" checked={settings.peptideTools} onChange={(v) => setSetting('peptideTools', v)}>
              Adds the Protocol tab: vials you mix, pens, syringe units for each dose, titration plans, on/off cycles, supplies, predictions and level estimates.
            </Switch>
          )}
          {HAS_BODY && (
            <Switch label="Training" checked={settings.trainingTools} onChange={(v) => setSetting('trainingTools', v)}>
              Adds the Training tab: workouts, cardio, personal bests, what to aim for next time and readiness. Also protein and water on Today, and soreness in check-ins.
            </Switch>
          )}
          {HAS_BODY && settings.trainingTools && (
            <div className="rounded-btn bg-surface-2 p-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label htmlFor="rest" className="block text-sm font-medium">Rest timer</label>
                  <select id="rest" value={settings.restSeconds} onChange={(e) => setSetting('restSeconds', Number(e.target.value))} className={`${selectCls} bg-surface`}>
                    <option value={0}>Off</option>
                    {[60, 90, 120, 150, 180, 240, 300].map((x) => <option key={x} value={x}>{x % 60 ? `${Math.floor(x / 60) ? `${Math.floor(x / 60)} min ` : ''}${x % 60} s` : `${x / 60} min`}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="bar" className="block text-sm font-medium">My barbell weighs</label>
                  <select id="bar" value={String(BARS[settings.units].reduce((b, x) => (Math.abs(fromLoad(x, settings.units) - settings.barKg) < Math.abs(fromLoad(b, settings.units) - settings.barKg) ? x : b)))}
                    onChange={(e) => setSetting('barKg', fromLoad(Number(e.target.value), settings.units))} className={`${selectCls} bg-surface`}>
                    {BARS[settings.units].map((x) => <option key={x} value={x}>{x} {loadUnit(settings.units)}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-sm text-muted">The rest timer starts when you tick a set. The plate calculator takes off the bar’s weight.</p>
              <Switch label="Work out rest for each set" checked={settings.smartRest} onChange={(v) => setSetting('smartRest', v)}>
                Starting from your rest timer: at least 3 min after heavy sets (5 reps or fewer) of big lifts, up to 1½ min for smaller muscles, 30 s more after a very hard set, and 15 s between supersets.
              </Switch>
              <Switch label="Adjust the next sets as I go" checked={settings.autoAdjust} onChange={(v) => setSetting('autoAdjust', v)}>
                After a set at RPE 7 or easier that hit its reps, the rest of that exercise goes up a step; after RPE 9.5+ or 2 reps short, down a step. Undo is on the message.
              </Switch>
              {isNative && (
                <Switch label="Remind me on my usual training days" checked={settings.trainingReminders} onChange={async (v) => { const on = await setTrainingReminders(v); if (v && !on) toast('Notifications are off for this app. Turn them on in your phone’s settings.'); }}>
                  Learned from when you train: 30 minutes before your usual time, skipped if you’ve already trained that day. Also a morning note when your sessions-a-week goal needs a session every day left.
                </Switch>
              )}
              <div className="grid grid-cols-2 gap-3">
                <TargetInput id="protein" label="Protein a day (g)" value={settings.proteinTargetG} onChange={(v) => setSetting('proteinTargetG', v)} />
                <TargetInput id="water" label="Water a day (mL)" value={settings.waterTargetMl} onChange={(v) => setSetting('waterTargetMl', v)} />
              </div>
              <p className="text-sm text-muted">Your own targets, from your dietitian or prescriber if you have one. Leave blank to just count.</p>
            </div>
          )}
          <Switch label="Track my cycle" checked={settings.cycleTracking} onChange={(v) => setSetting('cycleTracking', v)}>
            Adds a Period button to Today, and check-ins by phase of the cycle to Trends. Period starts are saved as check-ins, so they’re in backups and Family sync like other check-ins.
          </Switch>
        </Card>
      </Group>

      <Group title="Check-ins">
        <Card className="space-y-5">
          <div className="space-y-1.5">
            <label htmlFor="ci-delay" className="block text-sm font-medium">Suggest a check-in after a dose</label>
            <select id="ci-delay" value={settings.checkInDelayMin} onChange={(e) => setSetting('checkInDelayMin', Number(e.target.value))} className={selectCls}>
              <option value={0}>Off</option>
              {[30, 60, 90, 120, 180].map((m) => <option key={m} value={m}>{m < 60 ? `${m} minutes` : m === 90 ? '1½ hours' : `${m / 60} hour${m === 60 ? '' : 's'}`} later</option>)}
            </select>
            <p className="text-sm text-muted">Shows a “How are you feeling?” card on Today that long after a dose.{isNative ? '' : ` It can’t notify you: ${APP_NAME} in a browser can’t send notifications.`}</p>
          </div>
          <div>
            <span className="block text-sm font-medium mb-1">Options under “What are you noticing?”</span>
            <p className="text-sm text-muted mb-2">Removing one doesn’t change check-ins already saved.</p>
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
            {HAS_PEPTIDES && settings.peptideTools && SIDE_EFFECT_CHIPS.some((c) => !settings.chips.includes(c)) && (
              <Button variant="secondary" className="w-full mt-3" onClick={() => { setSetting('chips', [...settings.chips, ...SIDE_EFFECT_CHIPS.filter((c) => !settings.chips.includes(c))]); toast('Added to check-ins'); }}>
                Add common injection side effects
              </Button>
            )}
            {HAS_PEPTIDES && settings.peptideTools && SIDE_EFFECT_CHIPS.some((c) => !settings.chips.includes(c)) && <p className="text-sm text-muted mt-1">{SIDE_EFFECT_CHIPS.join(', ')}</p>}
            <button onClick={resetChips} className="mt-2 min-h-[44px] text-sm text-primary font-semibold">Reset to the defaults</button>
          </div>
        </Card>
      </Group>

      <Group title="Display">
        <Card className="space-y-5">
          {HAS_BODY && (
            <div className="space-y-1.5">
              <span className="block text-sm font-medium">Units for weight, measurements and training</span>
              <Segmented<Units> label="Units" value={settings.units} onChange={(v) => setSetting('units', v)}
                options={[{ value: 'metric', label: 'kg and cm' }, { value: 'imperial', label: 'lb and in' }]} />
            </div>
          )}
          <div className="space-y-1.5">
            <span className="block text-sm font-medium">Theme</span>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2">
              {([['system', 'Match phone'], ['light', 'Light'], ['dark', 'Dark']] as [Theme, string][]).map(([t, label]) => (
                <button key={t} role="radio" aria-checked={theme === t} onClick={() => { setTheme(t); setT(t); }}
                  className={`min-h-[48px] rounded-btn font-medium ${theme === t ? 'bg-primary text-on-primary' : 'bg-surface-2'}`}>
                  {label}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted">The theme is kept on this phone only.</p>
          </div>
        </Card>
      </Group>

      <Group title="Privacy and storage">
        <Card className="space-y-3">
          <h3 className="font-medium flex items-center gap-2"><Lock size={18} aria-hidden="true" /> App lock</h3>
          <p className="text-sm text-muted">A PIN screen that stops casual access on an unlocked phone. It doesn’t encrypt the data on the phone.</p>
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
          <h3 className="font-medium">Where your data is kept</h3>
          <p className="text-sm">{sync ? 'On this phone, with an encrypted copy sent to the phones in your Family sync.' : 'On this phone only. Nothing is sent anywhere unless you turn on Family sync.'}</p>
          {isNative ? (
            <p className="text-sm text-success font-medium" role="status">✓ Kept by the app. It’s only removed if you uninstall {APP_NAME}.</p>
          ) : persisted ? (
            <p className="text-sm text-success font-medium" role="status">✓ Protected from automatic clean-up.</p>
          ) : (
            <>
              <p className="text-sm text-muted" role="status">
                {persisted === false ? 'Your browser may clear this data if the phone runs low on space. Regular use and backups keep it safe.' : 'Checking…'}
              </p>
              {refused && (
                <div className="text-sm rounded-btn bg-surface-2 p-3 space-y-2" role="status">
                  <p className="font-medium">The browser decides this by itself; there’s no prompt to accept.</p>
                  {isIOS ? (
                    <p>Safari doesn’t let websites keep data for sure. It can remove a website’s data if you go 7 days of using Safari without opening it, so open {APP_NAME} at least every few days and keep a recent backup. The {APP_NAME} app doesn’t have this limit.</p>
                  ) : isAndroid ? (
                    <p>Chrome usually agrees once {APP_NAME} is installed{isStandalone ? '' : ' (Chrome menu → Install app)'} and used for a while. Try again in a few days.</p>
                  ) : (
                    <p>Browsers usually agree once a site is bookmarked or installed and used regularly. Try again later.</p>
                  )}
                  <p>Either way, backups keep your data safe: <a href="#/backup" className="text-primary font-semibold">Backup and restore</a>.</p>
                </div>
              )}
              <Button variant="secondary" className="w-full" onClick={requestPersist}>{refused ? 'Ask again' : 'Ask the browser to keep my data'}</Button>
            </>
          )}
        </Card>
      </Group>

      <Group title="Tools">
        <ToolLink href="#/tags" Icon={Nfc} title="Tags" sub={HAS_BODY ? 'Every tag: medications, gym machines, water bottle, scales' : 'Every tag: medications, blood pressure cuff, check-in'} />
        <ToolLink href={HAS_VISITS ? '#/appointments' : '#/labs'} Icon={CalendarCheck} title={HAS_VISITS ? 'Appointments and lab results' : 'Lab results'}
          sub={HAS_VISITS ? 'Questions to ask, and what’s changed since the last one' : 'Blood tests and others, typed in or from a photo'} />
        {HAS_VISITS && <ToolLink href="#/travel" Icon={Plane} title="Plan a trip" sub="Dose times across time zones" />}
        {HAS_PEPTIDES && settings.peptideTools && <ToolLink href="#/calc" Icon={Calculator} title="Peptide calculator" sub="Units for a dose, or the water for an easy number of units" />}
        {HAS_PEPTIDES && settings.peptideTools && <ToolLink href="#/supplies" Icon={Package} title="Supplies" sub="Syringes, needles, swabs, water and the sharps container" />}
        <ToolLink href="#/help" Icon={HelpCircle} title="Help, privacy and tag guide" sub="How each part works" />
      </Group>

      {isNativeAndroid && (
        <Card className="space-y-3">
          <h2 className="text-sm font-medium text-muted">Watch</h2>
          <p className="text-sm">On a Wear OS watch, {APP_NAME} shows your next dose (as an app and a tile) and logs it, or an as-needed medicine, with one tap. The log is made on this phone, so it needs the phone nearby with {APP_NAME} installed.</p>
          <details className="text-sm">
            <summary className="cursor-pointer min-h-[44px] flex items-center font-medium">How to install it on the watch</summary>
            <ol className="list-decimal pl-5 space-y-1 text-muted">
              <li>On the watch: Settings, System, About, then tap Build number 7 times to turn on developer options.</li>
              <li>In developer options, turn on ADB debugging and Wireless debugging.</li>
              <li>Download <a className="underline" href={watchDownload}>{edition.watchApk}</a>, then install it with <code>adb install {edition.watchApk}</code> from a computer on the same Wi-Fi (or a phone app that installs onto watches).</li>
              <li>Open {APP_NAME} on this phone once so it sends the watch your next dose.</li>
            </ol>
          </details>
        </Card>
      )}
      {isIOS && isNative && (
        <Card className="space-y-2">
          <h2 className="text-sm font-medium text-muted">Watch</h2>
          <p className="text-sm text-muted">An Apple Watch app isn’t available yet. Reminders still show on your watch as iPhone notifications.</p>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="text-sm font-medium text-muted">About {APP_NAME}</h2>
        {isNativeAndroid && BUILD > 0 && (
          <>
            <Switch label="Check for app updates" checked={settings.updateCheck} onChange={(v) => setSetting('updateCheck', v)}>
              Once a day, asks GitHub for the latest {APP_NAME} build (nothing about you is sent) and shows a card on Today when a newer one is out. You have build {BUILD}.
            </Switch>
            <Button variant="secondary" onClick={async () => { const u = await checkForUpdate(true); toast(u ? `Build ${u.build} is ready: see Today` : 'You have the latest build'); if (u) await setSetting('updateDismissed', 0); }}>Check now</Button>
          </>
        )}
        <p className="text-muted text-sm">{DISCLAIMER}</p>
      </Card>

      <Card className="space-y-2">
        <Button variant="danger" className="w-full" onClick={() => { setTyped(''); setEraseSheet(true); }}>Erase all data</Button>
        <p className="text-sm text-muted">Removes everything from this phone. You’ll be asked to confirm, and offered a backup first.</p>
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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 pt-2" aria-label={title}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ToolLink({ href, Icon, title, sub }: { href: string; Icon: typeof Plane; title: string; sub: string }) {
  return (
    <a href={href} className="border-t border-border py-4 flex items-center gap-3">
      <Icon className="text-primary" aria-hidden="true" />
      <span className="flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{sub}</span>
      </span>
      <ChevronRight className="text-muted" aria-hidden="true" />
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
