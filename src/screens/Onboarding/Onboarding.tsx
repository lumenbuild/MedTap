import { useState, type ReactNode } from 'react';
import { ArrowLeft, BellRing, Check, HardDriveDownload, LineChart, ListChecks, Lock, Nfc, Pill, Smartphone, Sparkles, type LucideIcon } from 'lucide-react';
import { useSettings } from '../../app/data';
import { Switch } from '../../components/ui/Switch';
import { HAS_BODY, HAS_PEPTIDES } from '../../edition';
import { APP_NAME } from '../../config';
import { isAndroid, isIOS, isNative, isNativeIOS, isStandalone } from '../../platform';
import { setSetting } from '../../db/repos/settings';
import { go } from '../../app/router';
import { useInstallPrompt } from '../../app/install';
import { setRemindersEnabled, syncReminders } from '../../app/native';
import { hashPin, isValidPin, newSalt } from '../../logic/pin';
import { Button } from '../../components/ui/Button';
import { TextInput } from '../../components/ui/Field';

/** One line with an icon, for the welcome and "what happens next" lists. */
const Point = ({ Icon, title, children }: { Icon: LucideIcon; title: string; children: ReactNode }) => (
  <li className="flex gap-3">
    <span aria-hidden="true" className="w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center shrink-0"><Icon size={20} className="text-primary" /></span>
    <span><span className="block font-semibold">{title}</span><span className="block text-muted text-[15px]">{children}</span></span>
  </li>
);

/**
 * First run: seven short steps, each one thing, with Back and Skip on every step. Welcome, this phone, what to track,
 * reminders, privacy, backups, then the first medication. Settings chosen here are the same ones in Settings, so
 * nothing is hidden away. Also opened from Help → Getting started → "Show the welcome again" (#/welcome).
 */
export function Onboarding({ again = false }: { again?: boolean }) {
  const [step, setStep] = useState(0);
  const install = useInstallPrompt();
  const settings = useSettings();
  const finish = async (to = '/today') => { await setSetting('onboarded', true); navigator.storage?.persist?.(); go(to); };

  // App lock, set right here (the same PIN as Settings → Privacy).
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [pinTried, setPinTried] = useState(false);
  const pinErr = !isValidPin(pin) ? 'Use 4 to 6 digits.' : pin !== pin2 ? "The PINs don't match." : '';
  const savePin = async () => {
    setPinTried(true);
    if (pinErr) return;
    const salt = newSalt();
    await setSetting('pinSalt', salt);
    await setSetting('pinHash', await hashPin(pin, salt));
    await setSetting('pinLength', pin.length);
    await setSetting('lockEnabled', true);
    setPin(''); setPin2('');
  };
  const [remindersMsg, setRemindersMsg] = useState('');
  const pinProps = { type: 'password', inputMode: 'numeric' as const, pattern: '[0-9]*', maxLength: 6, autoComplete: 'off' };

  const later = <p className="text-sm text-muted text-center">All of this is in Settings, to change any time.</p>;
  const next = (label = 'Next') => <Button className="w-full min-h-[56px]" onClick={() => setStep((n) => n + 1)}>{label}</Button>;
  const screens: { Icon: LucideIcon; title: string; body: ReactNode; actions: ReactNode }[] = [
    {
      Icon: Nfc,
      title: `Welcome to ${APP_NAME}`,
      body: (
        <>
          <ul className="space-y-4">
            <Point Icon={Nfc} title="Tap to log">Stick a tag on each medicine. Tap your phone on it and the dose is logged, with the time.</Point>
            <Point Icon={BellRing} title="Know what's next">Today shows what's due and what's done, and reminders can nudge you.</Point>
            <Point Icon={LineChart} title="See what works">Quick check-ins on how you feel, set against your doses, sleep and more.</Point>
          </ul>
          <p className="flex items-center gap-2 font-semibold"><Lock size={18} className="text-primary" aria-hidden="true" /> Your data stays on this phone.</p>
        </>
      ),
      actions: next('Get started'),
    },
    {
      Icon: Smartphone,
      title: isNative ? 'How tags work here' : isIOS ? 'Use it in Safari' : isAndroid ? 'Install the app' : 'Set up your phone',
      body: isNative ? (
        <>
          {isNativeIOS
            ? <p>To log with a tag, tap <strong>Scan tag</strong> at the top of Today, then hold the top of your iPhone near the tag.</p>
            : <p>Hold the back of your phone on a tag. {APP_NAME} opens straight to that medicine, even when it's closed, and logs the dose.</p>}
          <p className="text-muted">No tags yet? Any NTAG213 or NTAG215 sticker works. You can log by hand until they arrive.</p>
        </>
      ) : isIOS ? (
        <>
          <p>On iPhone, tag taps open in Safari, and home-screen apps keep separate data from Safari. So keep using {APP_NAME} in Safari: add it to your Favourites or bookmark it.</p>
          {isStandalone && <p className="rounded-btn bg-caution-soft p-3">You've opened the home-screen app. For tags to work, open {APP_NAME} in Safari instead.</p>}
        </>
      ) : isAndroid ? (
        <>
          <p>Install {APP_NAME} so it opens like an app and works without a connection. Tag taps then open straight into it.</p>
          {isStandalone ? <p className="font-semibold">✓ Installed.</p> : !install.available && <p className="text-sm text-muted">If you don't see an Install button, use the Chrome menu → Install app.</p>}
        </>
      ) : (
        <p>Open {APP_NAME} on your phone to use tags: iPhone in Safari, Android in Chrome. On a computer you can still log doses by hand.</p>
      ),
      actions: (
        <>
          {isAndroid && !isNative && install.available && !isStandalone && <Button className="w-full min-h-[56px]" onClick={() => install.prompt()}>Install app</Button>}
          <Button variant={isAndroid && !isNative && install.available && !isStandalone ? 'secondary' : 'primary'} className="w-full min-h-[56px]" onClick={() => setStep((n) => n + 1)}>Next</Button>
        </>
      ),
    },
    {
      Icon: ListChecks,
      title: 'What would you like to track?',
      body: (
        <>
          <p>Medicines and check-ins are always there. Turn on anything else that suits you.</p>
          {settings && (
            <div className="space-y-3">
              {HAS_PEPTIDES && <Switch label="Peptides and injections" checked={settings.peptideTools} onChange={(v) => setSetting('peptideTools', v)}>Vials you mix, pens, syringe units, titration plans and supplies.</Switch>}
              {HAS_BODY && <Switch label="Training" checked={settings.trainingTools} onChange={(v) => setSetting('trainingTools', v)}>Workouts, personal bests, what to aim for next time, protein and water.</Switch>}
            </div>
          )}
        </>
      ),
      actions: next(),
    },
    {
      Icon: BellRing,
      title: 'Reminders',
      body: isNative ? (
        <>
          <p>{APP_NAME} can remind you when a set-time dose is due, and again if it's late. Each reminder has Log it, In 15 min and Skip.</p>
          {settings && (
            <div className="space-y-3">
              <Switch label="Remind me when doses are due" checked={settings.remindersEnabled} onChange={async (v) => {
                setRemindersMsg('');
                const on = await setRemindersEnabled(v);
                if (v && !on) setRemindersMsg('Notifications are off for this app. You can allow them in your phone settings, then turn this on in Settings → Reminders.');
              }} />
              <Switch label="Hide medicine names" checked={settings.discreetReminders} onChange={async (v) => { await setSetting('discreetReminders', v); void syncReminders(); }}>Reminders say only “Reminder” and the time, for a lock screen others can see.</Switch>
            </div>
          )}
          {remindersMsg && <p role="alert" className="text-sm rounded-btn bg-caution-soft p-3">{remindersMsg}</p>}
        </>
      ) : (
        <>
          <p>Reminders come with the Android and iPhone apps. Here, Today shows what's due and what's done each time you open it.</p>
          <p className="text-muted">A calendar reminder works too: each dose on Today has <strong>Add to calendar</strong>.</p>
        </>
      ),
      actions: next(),
    },
    {
      Icon: Lock,
      title: 'Keep it private',
      body: (
        <>
          <p>Lock {APP_NAME} with a PIN so only you can open it. It locks when you leave the app, after a few minutes.</p>
          {settings?.lockEnabled ? (
            <p className="flex items-center gap-2 font-semibold"><Check size={18} className="text-success" aria-hidden="true" /> App lock is on.</p>
          ) : (
            <div className="space-y-3">
              <TextInput label="PIN (4 to 6 digits)" {...pinProps} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
              <TextInput label="Enter it again" {...pinProps} value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, ''))} error={pinTried ? pinErr || undefined : undefined} />
              <Button variant="secondary" className="w-full" onClick={savePin}>Set PIN</Button>
              <p className="text-sm text-muted">A forgotten PIN can't be recovered: only erasing and restoring a backup gets you back in.</p>
            </div>
          )}
          <p className="text-muted text-[15px]">Each medicine can also have a nickname, shown instead of its name wherever someone might glance.</p>
        </>
      ),
      actions: next(settings?.lockEnabled ? 'Next' : 'Not now'),
    },
    {
      Icon: HardDriveDownload,
      title: 'Back it up',
      body: (
        <>
          <p>Your records live only on this phone, so a lost or reset phone means lost records unless there's a backup.</p>
          <ul className="space-y-3">
            <Point Icon={HardDriveDownload} title="Back up now and then">Settings → Backup and restore makes a file you keep in your cloud drive or email. Today reminds you after a week.</Point>
            {isNative && <Point Icon={Sparkles} title="Or automatically">Pick a folder once and {APP_NAME} backs up there by itself.</Point>}
          </ul>
        </>
      ),
      actions: next(),
    },
    {
      Icon: Pill,
      title: 'Add your first medicine',
      body: (
        <>
          <p>It takes about two minutes. Here's what happens:</p>
          <ol className="space-y-3">
            <Point Icon={Pill} title="1. What and how often">Its name and strength, how much you take, and when. Or scan the pharmacy label.</Point>
            <Point Icon={Nfc} title="2. Link a tag">On the medicine's page, tap Link a tag and hold your phone on it.</Point>
            <Point Icon={Check} title="3. Test it">Tap the tag: you'll see the dose logged, with Undo in case it was a test.</Point>
          </ol>
          <a href="#/help/start" className="text-primary font-semibold underline underline-offset-4 inline-block min-h-[44px] pt-2" onClick={() => { void setSetting('onboarded', true); }}>Read the getting started guide</a>
        </>
      ),
      actions: (
        <>
          <Button className="w-full min-h-[56px]" onClick={() => finish('/meds/new')}>Add a medicine</Button>
          <Button variant="secondary" className="w-full" onClick={() => finish()}>{again ? 'Done' : "I'll do this later"}</Button>
        </>
      ),
    },
  ];
  const s = screens[step];

  return (
    <div className="min-h-[100dvh] flex flex-col pb-6" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex justify-between items-center h-14">
        {step > 0
          ? <button onClick={() => setStep((n) => n - 1)} aria-label="Back" className="w-11 h-11 -ml-3 flex items-center justify-center"><ArrowLeft size={22} aria-hidden="true" /></button>
          : <span className="w-11" />}
        <div className="flex gap-1.5" role="img" aria-label={`Step ${step + 1} of ${screens.length}`}>
          {screens.map((_, i) => <span key={i} className={`h-1.5 rounded-full transition-all ${i === step ? 'w-6 bg-primary' : i < step ? 'w-1.5 bg-primary' : 'w-1.5 bg-border-strong'}`} />)}
        </div>
        <button onClick={() => finish()} className="min-h-[48px] px-3 -mr-3 text-primary font-semibold">Skip</button>
      </div>
      <main className="flex-1 flex flex-col">
        <div className="flex-1 flex flex-col justify-center space-y-4 py-4">
          <s.Icon size={44} className="text-primary" aria-hidden="true" />
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          {s.body}
        </div>
        <div className="space-y-3 pt-4">{s.actions}{step > 1 && step < screens.length - 1 && later}</div>
      </main>
    </div>
  );
}
