import { useState } from 'react';
import { ListChecks, Lock, Nfc, Pill, Smartphone } from 'lucide-react';
import { useSettings } from '../../app/data';
import { Switch } from '../../components/ui/Switch';
import { HAS_BODY, HAS_PEPTIDES } from '../../edition';
import { APP_NAME, DISCLAIMER } from '../../config';
import { isAndroid, isIOS, isNative, isNativeIOS, isStandalone } from '../../platform';
import { setSetting } from '../../db/repos/settings';
import { go } from '../../app/router';
import { useInstallPrompt } from '../../app/install';
import { Button } from '../../components/ui/Button';

/** First run, at most 4 short screens, always skippable. The 4th step (link a tag) happens on the medication's page. */
export function Onboarding() {
  const [step, setStep] = useState(0);
  const install = useInstallPrompt();
  const settings = useSettings();
  const finish = async (to = '/today') => { await setSetting('onboarded', true); navigator.storage?.persist?.(); go(to); };

  const later = <p className="text-sm text-muted text-center">You can change this later in Settings.</p>;
  const screens = [
    {
      Icon: Nfc,
      title: `Welcome to ${APP_NAME}`,
      body: (
        <>
          <p>Tap your phone on a tag stuck to your medication to log a dose in seconds. See when your next dose is due, and keep track of how you feel.</p>
          <p className="flex items-center gap-2 font-semibold"><Lock size={18} className="text-primary" aria-hidden="true" /> Your data stays on this phone.</p>
          <p className="text-sm text-muted">{DISCLAIMER}</p>
        </>
      ),
      next: <Button className="w-full min-h-[56px]" onClick={() => setStep(1)}>Get started</Button>,
    },
    {
      Icon: Smartphone,
      title: isNative ? 'Tags and reminders' : isIOS ? 'Use it in Safari' : isAndroid ? 'Install the app' : 'Set up your phone',
      body: isNative ? (
        <>
          {isNativeIOS
            ? <p>To log with a tag, tap <strong>Scan tag</strong> at the top of Today and hold the top of your iPhone near it.</p>
            : <p>Tapping a tag opens {APP_NAME} straight to that medication, even when the app is closed.</p>}
          <p>{APP_NAME} can remind you when set-time doses are due. Turn reminders on in Settings.</p>
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
      next: (
        <>
          {isAndroid && install.available && !isStandalone && <Button className="w-full min-h-[56px]" onClick={() => install.prompt()}>Install app</Button>}
          <Button variant={isAndroid && install.available && !isStandalone ? 'secondary' : 'primary'} className="w-full min-h-[56px]" onClick={() => setStep(2)}>Next</Button>
        </>
      ),
    },
    {
      Icon: ListChecks,
      title: 'What would you like to track?',
      body: (
        <>
          <p>Medications and check-ins are always there. Turn on what else suits you; you can change it any time in Settings.</p>
          {settings && (
            <div className="space-y-3">
              {HAS_PEPTIDES && <Switch label="Peptides and injections" checked={settings.peptideTools} onChange={(v) => setSetting('peptideTools', v)}>Vials you mix, pens, syringe units, titration plans and supplies.</Switch>}
              {HAS_BODY && <Switch label="Training" checked={settings.trainingTools} onChange={(v) => setSetting('trainingTools', v)}>Workouts, personal bests, what to aim for next time, protein and water. Tags work on gym machines and water bottles too.</Switch>}
              <Switch label="My cycle" checked={settings.cycleTracking} onChange={(v) => setSetting('cycleTracking', v)}>A Period button on Today, and check-ins by phase of the cycle.</Switch>
            </div>
          )}
        </>
      ),
      next: <Button className="w-full min-h-[56px]" onClick={() => setStep(3)}>Next</Button>,
    },
    {
      Icon: Pill,
      title: 'Add your first medication',
      body: (
        <>
          <p>Enter it the way your prescriber told you: how much, and how often. {APP_NAME} only reminds you of your own settings.</p>
          <p>Then link a tag to it and test it. It takes about two minutes.</p>
        </>
      ),
      next: (
        <>
          <Button className="w-full min-h-[56px]" onClick={() => finish('/meds/new')}>Add a medication</Button>
          <Button variant="secondary" className="w-full" onClick={() => finish()}>I'll do this later</Button>
        </>
      ),
    },
  ];
  const s = screens[step];

  return (
    <div className="min-h-[100dvh] flex flex-col pb-6" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="flex justify-between items-center h-14">
        <span className="text-sm text-muted tnum" aria-label={`Step ${step + 1} of ${screens.length}`}>{step + 1} / {screens.length}</span>
        <button onClick={() => finish()} className="min-h-[48px] px-3 -mr-3 text-primary font-semibold">Skip</button>
      </div>
      <div className="flex-1 flex flex-col justify-center space-y-4">
        <s.Icon size={48} className="text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        {s.body}
      </div>
      <div className="space-y-3 pt-6">{s.next}{step > 0 && later}</div>
    </div>
  );
}
