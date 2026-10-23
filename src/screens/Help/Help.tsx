import type { ReactNode } from 'react';
import { BellRing, Sparkles, CalendarClock, ChevronRight, Compass, Info, Lock, Nfc, RefreshCw, ScanText, ShieldCheck, Smartphone, Syringe, Target, Users, Dumbbell } from 'lucide-react';
import { isNative, isNativeIOS } from '../../platform';
import { APP_NAME, DISCLAIMER } from '../../config';
import { tagBase } from '../../nfc/url';
import { Card } from '../../components/ui/Card';
import { apkDownload, edition, HAS_BODY, HAS_PEPTIDES, HAS_VISITS } from '../../edition';
import { useViewMode } from '../../app/viewMode';

const TOPICS = [
  { id: 'start', title: 'Getting started', Icon: Compass },
  { id: 'schedules', title: 'Setting up a schedule', Icon: CalendarClock },
  { id: 'scan', title: 'Scanning a pharmacy label', Icon: ScanText },
  ...(HAS_BODY ? [{ id: 'goals', title: 'Goals and forecasts', Icon: Target }] as const : []),
  ...(HAS_BODY ? [{ id: 'training', title: 'Training and fitness', Icon: Dumbbell }] as const : []),
  { id: 'peptides', title: 'Peptides and injections', Icon: Syringe, peptides: true },
  { id: 'family', title: 'Family members', Icon: Users },
  { id: 'sync', title: 'Family sync', Icon: RefreshCw },
  { id: 'tags', title: 'Which tags work', Icon: Nfc },
  { id: 'phones', title: 'iPhone and Android', Icon: Smartphone },
  { id: 'reminders', title: 'Reminders', Icon: BellRing },
  { id: 'patterns', title: 'Patterns and planning', Icon: Sparkles },
  { id: 'privacy', title: 'Privacy', Icon: ShieldCheck },
  { id: 'lock', title: 'App lock', Icon: Lock },
  { id: 'about', title: `About ${APP_NAME}`, Icon: Info },
] as const;

export const helpTitle = (topic?: string, peptides = HAS_PEPTIDES) => TOPICS.filter((t) => !('peptides' in t) || peptides).find((t) => t.id === topic)?.title ?? 'Help';

/** Peptide help only where the peptide tools can be shown (MedTap, and not in the private view). */
const usePeptideHelp = () => { const v = useViewMode(); return HAS_PEPTIDES && v !== 'private'; };
const Pep = ({ children }: { children: ReactNode }) => (usePeptideHelp() ? <>{children}</> : null);

export function Help({ topic }: { topic?: string }) {
  const peptides = usePeptideHelp();
  const topics = TOPICS.filter((t) => !('peptides' in t) || peptides);
  if (!topic) {
    return (
      <ul className="space-y-2">
        {topics.map(({ id, title, Icon }) => (
          <li key={id}>
            <a href={`#/help/${id}`} className="border-t border-border py-4 min-h-[56px] flex items-center gap-3">
              <Icon className="text-primary" aria-hidden="true" />
              <span className="flex-1 font-medium">{title}</span>
              <ChevronRight className="text-muted" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    );
  }
  const page = topics.some((t) => t.id === topic) ? CONTENT[topic] : undefined;
  return <Card className="space-y-4 help-prose">{page ?? <p>That help page doesn't exist.</p>}</Card>;
}

const H = ({ children }: { children: ReactNode }) => <h2 className="text-sm font-medium text-muted">{children}</h2>;

/** Only in the full view (the private view never mentions itself). */
const FullView = ({ children }: { children: ReactNode }) => (useViewMode() === 'private' ? null : <>{children}</>);
const Step = ({ n, title, children }: { n: number; title: string; children: ReactNode }) => (
  <section className="flex gap-3">
    <span aria-hidden="true" className="w-8 h-8 rounded-full bg-primary text-on-primary font-semibold flex items-center justify-center shrink-0 tnum">{n}</span>
    <div className="flex-1 min-w-0 space-y-2"><h2 className="font-semibold text-[17px] leading-8">{title}</h2>{children}</div>
  </section>
);

const CONTENT: Record<string, ReactNode> = {
  start: (
    <>
      <p>{APP_NAME} in ten steps, from your first medicine to backups. Each takes a minute or two; do them in any order.</p>
      <Step n={1} title="Add a medicine">
        <p>Meds → <strong>Add medication</strong>. Its name and strength, how much you usually take, and when: set times, every few hours, or as needed. Or tap <strong>Take photo</strong> to fill it in from the pharmacy label, then check it.</p>
        <p>Not every day? Choose certain days or every few days. A dose that changes over time? Use <strong>Plan a change</strong> on its page.</p>
      </Step>
      <Step n={2} title="Get tags and stick one on">
        <p>Any NTAG213 or NTAG215 NFC sticker works; they're cheap online. Stick one on the box, bottle or pen. On foil packs or metal tins, use tags sold as <em>on-metal</em>.</p>
      </Step>
      <Step n={3} title="Link the tag">
        <p>On the medicine's page, tap <strong>Link a tag</strong> and hold your phone on it.{isNativeIOS ? ' On iPhone, hold the top of the phone near the tag.' : ' On Android, the back of the phone, near the middle.'}</p>
        <p>One tag per medicine. A tag can also log a coffee, water, a check-in or a gym machine: Settings → Tags.</p>
      </Step>
      <Step n={4} title="Log a dose">
        <p>Tap the tag: the dose is logged at your usual amount, with <strong>Undo</strong> for a few seconds. Tapped twice by mistake? {APP_NAME} asks before logging the same medicine again within a few minutes.</p>
        <p>No tag to hand? Tap <strong>Log dose</strong> on Today. Took it earlier? Change the time before saving. Missed it? Use <strong>Skip this dose</strong> so the plan stays right.</p>
      </Step>
      <Step n={5} title="Read Today">
        <p>The big number is your next dose. Below it: each medicine and whether it's done, as-needed medicines with when you last had them, and quick buttons for a check-in, blood pressure{HAS_BODY ? ', weight' : ''} and more.</p>
        <p>Notes appear only when they matter: stock running low, a script to renew, a pattern worth knowing.</p>
      </Step>
      <Step n={6} title="Check in">
        <p>A few taps on mood, focus, energy and anything you noticed. {APP_NAME} asks a while after a dose, and Trends sets them against your doses, sleep and more. The more check-ins, the sharper the patterns.</p>
      </Step>
      <Step n={7} title="Reminders">
        {isNative
          ? <p>Settings → <strong>Reminders</strong>. Each reminder has Log it, In 15 min and Skip. <strong>Hide medicine names</strong> makes them say only “Reminder” and the time. <strong>Send a test reminder</strong> there checks your phone delivers them on time.</p>
          : <p>Reminders come with the Android and iPhone apps. In the browser, add a dose to your calendar from Today.</p>}
      </Step>
      <Step n={8} title="Privacy">
        <p>Settings → <strong>Privacy</strong> → <strong>Set a PIN</strong> to lock the app. A medicine can have a nickname, shown instead of its name wherever someone might glance.</p>
        <FullView><p>With a PIN set, a second <strong>privacy PIN</strong> can open the app with chosen medicines under a cover name or left out. Choose for each medicine on its page.</p></FullView>
      </Step>
      <Step n={9} title="Back up">
        <p>Your records live only on this phone. Settings → <strong>Backup and restore</strong> makes a file to keep in your cloud drive or email{isNative ? ', or picks a folder for automatic backups' : ''}. Today reminds you after a week.</p>
      </Step>
      <Step n={10} title="Make it yours">
        <ul className="list-disc pl-5 space-y-1">
          <Pep><li><strong>Peptides and injections</strong>: vials, pens, syringe units, titration plans, supplies.</li></Pep>
          {HAS_BODY && <li><strong>Training</strong>: workouts, bests, what to aim for next, protein and water.</li>}
          <li><strong>Family</strong>: track medicines for others on this phone, and sync with their phones, encrypted.</li>
          {isNative && <li><strong>Widgets and the watch</strong>: the next dose on your home screen, and a tap to log from your wrist.</li>}
          <li><strong>Doctor report</strong>: at the bottom of Trends, to print or send.</li>
        </ul>
      </Step>
      <p className="pt-2"><a href="#/welcome" className="text-primary font-semibold underline underline-offset-4">Show the welcome again</a></p>
    </>
  ),
  training: (
    <>
      <H>Turning it on</H>
      <p>Settings → <strong>Training</strong>. This adds a Training tab, protein and water on Today, and a soreness rating in check-ins. Turning it off hides them; nothing is deleted.</p>
      <H>Logging a workout</H>
      <ol className="list-decimal pl-5 space-y-1">
        <li>On Training, tap <strong>Start a workout</strong>: empty, from a routine, or a repeat of a past session.</li>
        <li>Each set has weight, reps and, if you like, how hard it felt (RPE: 10 is nothing left, 8 is two reps left). Tap the set number to mark a warm-up; warm-ups don't count towards bests.</li>
        <li>Tick a set when it's done. The rest timer starts (change it in Settings → Training).</li>
        <li><strong>Finish</strong> shows any new personal bests and offers to save the session as a routine.</li>
      </ol>
      <H>What it works out</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Personal bests</strong>: heaviest weight, most reps at a weight, and an estimated one-rep max (from your best set of up to 12 reps).</li>
        <li><strong>Aim for next time</strong>: up a step when every set hit its reps, the same weight to add reps, or about 10% lighter after a stall.</li>
        <li><strong>Worth a lighter week</strong>: a lift that hasn't improved for about 3 weeks, or feels harder at the same weight.</li>
        <li><strong>Strength goals</strong>: a date with a range, from the trend in your estimated max, like weight goals.</li>
        <li><strong>Ready to train</strong>: today's sleep, resting heart rate and heart rate variability against your own last 4 weeks (from Health Connect or Apple Health), and soreness from a check-in.</li>
        <li><strong>Sets per muscle</strong>: the last 7 days, and push against pull, upper against lower.</li>
        <li><strong>Lean mass while losing weight</strong>: log body fat % or lean mass (Body → Add measurements or body fat) and it shows how much of the weight you've lost was lean mass, by dose with peptide tools on.</li>
        <li><strong>Strength and your peptide</strong>: each session against your recent level, by days since the shot and by dose.</li>
      </ul>
      <p>These are worked out from your own records. They're not a training programme or medical advice.</p>
    </>
  ),
  goals: (
    <>
      <H>Setting a goal</H>
      <p>On Body, tap <strong>Set a goal</strong> and choose weight, waist, body fat or lean mass (body fat and lean mass need entries from a smart scale or scan). Enter the goal and, if you like, a date. {APP_NAME} starts from where your trend is now.</p>
      <H>How the forecast works</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Trend, not the scale.</strong> Weight swings by a kilo or more day to day with water and food. The forecast uses the trend over the last 4 weeks, worked out so one odd day barely moves it.</li>
        <li><strong>A date with a range.</strong> “Likely around 28 Mar, between 12 Mar and 2 Apr.” The range narrows the more steadily you log.</li>
        <li><strong>It updates every time you log</strong>, and shows how the date has moved since last week.</li>
        <li><strong>Slow-downs</strong> are pointed out, and the forecast follows the recent rate rather than an early fast start.</li>
        <li><strong>Milestones</strong>: 5% and 10% down, halfway, and the goal, each dated when the trend reaches it.</li>
        <li><strong>With a date</strong>, it says whether you're on track and the weekly pace that would get you there. A pace faster than about 1% of body weight a week gets a note to check with your doctor.</li>
        <li><strong>After you reach it</strong>, the card shows how close you're holding to it.</li>
      </ul>
      <H>Getting the best forecast</H>
      <p>Weigh in every day if you can, at the same time (first thing in the morning, after the bathroom, before eating). It needs at least 5 weigh-ins over a week to start. Gaps are fine; it just gets less certain.</p>
      <p>The forecast describes your own trend. It isn't advice about how fast to go; your doctor can help with that.</p>
    </>
  ),
  patterns: (
    <>
      <p>{APP_NAME} learns from your own logs, on this phone. Each pattern says what it's based on; they're links in your records, not advice.</p>
      <H>On a medication's page</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>When you take it</strong>, on weekdays and weekends. If that's 20+ minutes from the reminder, <strong>Use these times</strong> moves the reminders (the plan's times stay the same).</li>
        <li><strong>Often missed</strong>: a day and time missed 2+ times in the last 8 weeks. Reminders add an extra nudge then.</li>
        <li><strong>Effect window</strong>: from check-ins after doses, when focus usually rises and when it wears off.</li>
        <li><strong>New script</strong>: when the stock and repeats left run out (or the script expires), and when to book your doctor.</li>
      </ul>
      <H>Today</H>
      <p>The effect window for today's dose, when to book a doctor for a script, records that look odd (a dose logged twice{HAS_BODY ? ', a typo in a weight' : ''}, a date in the future){HAS_VISITS ? ', and your next appointment' : ''}.</p>
      <H>Trends</H>
      <p><strong>The coming days</strong> (likely focus, mood and appetite) and <strong>Last dose and sleep</strong> (the time after which sleep is usually worse){HAS_VISITS ? <>, and <strong>Appt</strong> to compare with before your last appointment</> : null}.</p>
      <H>Reminders</H>
      <p>In the app, <strong>Nudge me if I haven't logged it</strong> sends a second reminder a while after your usual time.</p>
      {HAS_VISITS ? (
        <>
          <H>Appointments, lab results and trips</H>
          <p>Settings → <strong>Appointments and lab results</strong>: add appointments and questions, then print a one-page summary of what's changed since the last one. Lab results can be read from a photo of the printout. Settings → <strong>Plan a trip</strong> shows dose times across time zones, switching straight away or moving 2 hours a day.</p>
        </>
      ) : (
        <>
          <H>Lab results</H>
          <p>Settings → <strong>Lab results</strong>: type them in or read them from a photo of the printout. They're in the doctor report.</p>
        </>
      )}
      <p>Check-in notes suggest chips (“bit queasy” → Nausea)<Pep>, and adding vials can read the lot and expiry from a photo of the label</Pep>.</p>
      <H>More patterns in Trends</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Days on and off</strong>: check-ins on days you took a medicine against days you didn't.</li>
        <li><strong>Caffeine and alcohol</strong>: tap Coffee or Alcohol on Today; Trends compares the next morning's sleep (and, for alcohol, side effects the next day).</li>
        <li><strong>Your cycle</strong> (optional, Settings → Check-ins): a Period button on Today, and check-ins by phase of the cycle.</li>
        <li><strong>Heart rate after a dose</strong>{HAS_BODY ? <> and <strong>steps and weight</strong></> : null}: from Health Connect or Apple Health.</li>
      </ul>
      <H>Count what's left</H>
      <p>On a tablet or capsule's page, <strong>Count what's left</strong>: type the count or take a photo of them spread out on a plain surface (counted on the phone). It compares with what your logs say should be left, and can log doses you took but didn't log.</p>
      <H>In the app</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Health Connect / Apple Health</strong> (Settings): read only; steps, sleep and heart rate{HAS_BODY ? ', weigh-ins' : ''} and blood pressure. Imports again when you open the app.</li>
        <li><strong>Widget</strong> (Android): add {APP_NAME} from your home screen's widgets: the next dose with a countdown, and buttons for as-needed medicines.</li>
        <li><strong>Shortcuts</strong>: on Android, long-press the app icon for “Log …” (drag one to your home screen). On iPhone, ask Siri “Log Vyvanse in {APP_NAME}”, or use the Shortcuts app.</li>
        <li><strong>Reminder check</strong> (Settings → Reminders): what could stop or delay reminders on your phone, with a fix for each, and a test reminder.</li>
      </ul>
    </>
  ),
  peptides: (
    <>
      <H>Turning it on</H>
      <p>Settings → <strong>Peptides and injections</strong>. This adds vials you mix, pre-filled pens, syringe units, a calculator, titration plans, on/off cycles, supplies, and charts in Trends. Turning it off hides them; nothing is deleted.</p>
      <H>A vial you mix</H>
      <ol className="list-decimal pl-5 space-y-1">
        <li>Add the medication with Form <strong>Injection</strong>, and choose <strong>A vial I mix with water</strong>.</li>
        <li>Enter the <strong>amount in each vial</strong>, the water you usually add, and your syringe (U-100 0.3 mL is common).</li>
        <li>Set the dose and schedule your prescriber gave you.</li>
      </ol>
      <p>Each time you mix one, tap <strong>I've mixed a new vial</strong> and enter the water you used. Units are worked out from <em>that</em> vial, so a vial mixed with more or less water still shows the right units. Log dose shows what to draw, e.g. <strong>10 units · 0.1 mL</strong>, and Today shows it on the card.</p>
      <H>Pre-filled pens</H>
      <p>Choose <strong>A pre-filled pen</strong> and enter the amount in each pen. If you add the amount per click of the dial (from the pen's instructions), Log dose shows the clicks for each dose. Tap <strong>I've started a new pen</strong> when you start one; Today warns when it's nearly empty or past its in-use days.</p>
      <H>Blends</H>
      <p>If a vial holds more than one peptide, add the others under <strong>Blend</strong> with their amount per vial. Log dose and Trends show how much of each you took.</p>
      <H>Stock and batches</H>
      <p>On the medication's page, <strong>Add</strong> vials or pens to stock with their lot, expiry, supplier and purity. Mixing a new vial takes the one that expires soonest. Tap any vial to add photos of its label or certificate of analysis, and to see the doses taken from it, so you can trace a batch.</p>
      <H>Supplies</H>
      <p>Settings → Peptides and injections → <strong>Supplies</strong>. Enter how many syringes, pen needles and swabs you have, and your water. They count down as you log injections and mix vials. The sharps container counts up, and Today reminds you when it's nearly full.</p>
      <H>On and off cycles</H>
      <p>In a medication's schedule, tick <strong>On and off cycles</strong>, e.g. 8 weeks on, 4 off, or 5 days on, 2 off. Off days aren't scheduled, and Today shows “Week 3 of 8 on” or “Off until …”.</p>
      <H>Titration</H>
      <p>On the medication's page, <strong>Plan a titration</strong>: the first dose, the step up (or down), how often, and the final dose. Each step is a planned change that switches over on its day, and it's marked on the weight chart.</p>
      <H>Charts</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Estimated level</strong>: enter a half-life on the medication and Trends estimates the amount in your body from your doses. It's a simple model on the figure you enter, not a measurement.</li>
        <li><strong>Dose levels</strong>: for each dose you've been on, your weight change, appetite and what you noted in check-ins. Settings can add common injection side effects to check-ins.</li>
      </ul>
      <H>Predictions (Protocol tab)</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>The coming week</strong> and <strong>appetite through the week</strong>: from your check-ins by day after each shot, what usually shows up on each of the next 7 days, and where today sits.</li>
        <li><strong>Weight path</strong>: where your weight is heading for 12 weeks, with a likely range, following your planned dose changes. A step you've been on before uses your own rate on it.</li>
        <li><strong>Vial</strong>: which planned shot is the last full one from the vial in use, and what's left over or past its use-by.</li>
        <li><strong>Enough until…</strong>: pick a date (a trip, a planned change) to see the stock and supplies you'll need, and what to order.</li>
        <li><strong>Patterns</strong>: weeks compared by shot time, sleep, batch, water and missed shots, on side effects and appetite.</li>
        <li><strong>Worth a look</strong>: side effects up on a new batch, the weight trend flattening, or sleep down after a step up.</li>
        <li><strong>Late or missed</strong>: shots 12+ hours late or missed, how much lower the estimated level was, and what followed.</li>
        <li><strong>Best shot day</strong>: mark your busy days to see which shot day keeps your usual side-effect days off them.</li>
        <li><strong>Last 7 days</strong> on Today and in the protocol report: shots on time, level range, weight rate, side effects and stock.</li>
      </ul>
      <p>Each says what it's based on. They're estimates from your own records, not advice: they show links, not causes, and never suggest a dose.</p>
      <H>Calculator</H>
      <p>Settings → Peptides and injections → <strong>Peptide calculator</strong>: units for a dose, the dose for a number of units, or the water that makes your dose an easy number of units.</p>
      <H>Check your numbers</H>
      <p>{APP_NAME} only does sums on the numbers you enter; it doesn't suggest doses. Check against the label, your prescriber's directions or your pharmacist, especially the first time. Under 2 units is hard to measure accurately.</p>
    </>
  ),

  scan: (
    <>
      <H>Fill in a medication from its label</H>
      <p>In Meds, tap <strong>Add</strong>, then <strong>Take photo</strong> (or <strong>Choose photo</strong>) under “Scan the pharmacy label”. {APP_NAME} reads the label and fills in the name, strength, directions, schedule, quantity and repeats.</p>
      <p>The photo is read on your phone. It isn't uploaded or kept. {isNative ? '' : 'The first scan downloads the reader (about 6 MB) from this site; after that it works offline.'}</p>
      <H>Check everything</H>
      <p>Labels vary and photos can be misread. Before you save, check every detail against the label. If something was misread, fix the text on the review screen and the details update, or edit the form. Ask your pharmacist about anything unclear.</p>
      <H>For a good read</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>Lay the box or bottle flat, in good light, without glare.</li>
        <li>Fill the photo with the label and hold the phone still.</li>
        <li>For round bottles, photograph the part with the directions.</li>
      </ul>
    </>
  ),
  sync: (
    <>
      <H>Keep phones the same</H>
      <p>Family sync shares {APP_NAME}'s records between your phones and your family's: medications, doses, check-ins, {HAS_BODY ? 'weight, ' : ''}blood pressure and tags. A dose logged on one phone shows on the others, and stock counts include doses logged on every phone. {HAS_BODY ? 'Photos and settings stay' : 'Settings stay'} on each phone.</p>
      <H>Setting it up</H>
      <ol className="list-decimal pl-5 space-y-1">
        <li>On one phone: Settings → Family sync. Enter your name and tap <strong>Start family sync</strong>.</li>
        <li>Tap <strong>Invite a phone</strong>. On the other phone, scan the QR code with the camera (or send the invite privately and open it there).</li>
        <li>On the other phone, enter your name and tap <strong>Join</strong>. Anything already on that phone is kept, under that name.</li>
      </ol>
      <H>How phones swap records</H>
      <p>With a <strong>sync server</strong>, phones sync by themselves every few minutes while {APP_NAME} is open. You can run your own for free (see sync-relay in {APP_NAME}'s code). Without one, tap <strong>Send update</strong> to send a file by Messages, email or AirDrop, and <strong>Open update</strong> on the other phone.</p>
      <H>Privacy</H>
      <p>Records are encrypted on the phone with a key only your family's phones have. A sync server, or anyone who sees an update file, gets only scrambled data. Anyone with the invite can see and change everything, so only send it to people you trust.</p>
      <p>If two phones change the same thing before syncing, the later change wins.</p>
    </>
  ),
  family: (
    <>
      <H>Tracking for more than one person</H>
      <p>Go to Settings → Family members → <strong>Add a family member</strong>. You start as “Me”, which you can rename.</p>
      <p>Each person has their own medications, check-ins, {HAS_BODY ? 'weight, measurements, blood pressure, photos' : 'blood pressure'}, charts and doctor report. Choose who to show with the names at the top of Today, Trends, {HAS_BODY ? 'Body' : 'Vitals'} and Meds.</p>
      <p>On Today, <strong>Everyone</strong> shows every person's medications at once, each card labelled with whose it is. Handy when you're giving doses to several people.</p>
      <H>Tags</H>
      <p>A tag always belongs to one person's medication. When it's tapped, the screen says <strong>For Sam</strong> (or whoever) in large text, so a dose is never logged against the wrong person. Calendar reminders include the name too.</p>
      <H>Shared medications</H>
      <p>For something everyone uses, like Panadol, choose <strong>Shared</strong> under “Who is this for?”. There's one stock count for the bottle, and each time it's logged you choose who took it. A tag tap always asks, so it's never logged for the wrong person.</p>
      <p>Each person's “last taken”, count for the day and double-tap check only look at their own doses, so one person taking it doesn't hold up another. Each person's charts and report show only their own doses.</p>
      <H>Removing someone</H>
      <p>To avoid losing history by accident, a person can only be removed once their medications and entries have been deleted. Archiving a medication keeps its history.</p>
    </>
  ),
  schedules: (
    <>
      <H>Three kinds of schedule</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Every few hours</strong>: the countdown starts from your last dose.</li>
        <li><strong>Set times</strong>: the same clock times each scheduled day.</li>
        <li><strong>As needed</strong>: no countdown, just when you last took it.</li>
      </ul>
      <p>Enter what your prescriber told you. {APP_NAME} only shows your own settings back to you.</p>
      <H>Different amounts in one day</H>
      <p>Example: 20 mg, then 20 mg four hours later, then 10 mg four hours after that (50 mg a day, using 10 mg tablets).</p>
      <ol className="list-decimal pl-5 space-y-1">
        <li>Strength: <strong>10 mg</strong>. Schedule: <strong>Every few hours</strong>, hours between doses: <strong>4</strong>.</li>
        <li>Tick <strong>The amount changes from dose to dose</strong>.</li>
        <li>1st dose <strong>20</strong>, 2nd dose <strong>20</strong>, Add a dose, 3rd dose <strong>10</strong>.</li>
      </ol>
      <p>Each time you log, the right amount is filled in, along with how many tablets that is. Today shows “Today: 2 of 3 · 40 mg of 50 mg”.</p>
      <H>Certain days of the week</H>
      <p>Example: an injection of 2.5 mg on Sunday morning and Wednesday morning.</p>
      <ol className="list-decimal pl-5 space-y-1">
        <li>Schedule: <strong>Set times</strong>. Time <strong>8:00 am</strong>, amount <strong>2.5</strong>.</li>
        <li>Which days: <strong>Certain days</strong>, then tap <strong>Su</strong> and <strong>We</strong>.</li>
      </ol>
      <p>On other days, Today shows “Not scheduled today” and counts down to the next one.</p>
      <H>Every few days</H>
      <p>For something every second day, fortnightly or every 4 weeks, choose <strong>Every few days</strong>, enter the number of days (for example 14) and a day you take it.</p>
      <H>Set times with different amounts</H>
      <p>Each set time can have its own amount, such as 10 mg at 8 am and 5 mg at 1 pm. Leave an amount blank to use your usual dose.</p>
      <H>Instructions</H>
      <p>Each medication has an Instructions box. Anything typed there, by you, a carer, pharmacist or doctor, shows every time the tag is tapped or a dose is logged.</p>
      <H>When your prescription changes</H>
      <p>For a change starting today, edit the medication. {APP_NAME} asks whether to record it as a change on a date, so your charts show when it happened.</p>
      <p>For a change on a future date, or a taper in steps, open the medication and use <strong>Plan a change</strong>. Add one change per step. On each date {APP_NAME} switches to the new schedule by itself and records it.</p>
      <H>Skipping a dose</H>
      <p>If you don't take a dose on purpose, open Log dose and choose <strong>Skip this dose</strong>, with a reason if you like. It holds that dose's place in your day (so the next amount and time move on), isn't counted as taken, and doesn't change your stock.</p>
      <H>Limits for as-needed medications</H>
      <p>For something like paracetamol, you can enter your limits: how many doses in 24 hours, the most in 24 hours (such as 4000 mg), and the hours to wait between doses. Use the limits on the packet or from your pharmacist or doctor.</p>
      <p>Today then shows how much you've had in the last 24 hours and when the wait ends. If logging a dose would go over a limit, {APP_NAME} tells you, but it never stops you logging.</p>
      <H>Travelling</H>
      <p>Set times follow your home time zone. When your phone changes time zone, Today asks whether to keep home time (useful on short trips or for time-critical medications) or follow the phone's time. Change this any time in Settings. Check timing changes with your pharmacist or doctor.</p>
      <H>Refills</H>
      <p>Add how many you have and, optionally, your repeats and script expiry date. {APP_NAME} works out when you'll run out from your schedule (or your recent use for as-needed medications) and shows a card on Today a few days before. Tap <strong>Add stock</strong> when you pick up a refill.</p>
      <H>Expiry dates</H>
      <p>When you add stock you can enter the bottle's expiry date and where it's kept. Each bottle is listed on the medication's page, and Today warns you 30 days before one expires.</p>
    </>
  ),
  tags: (
    <>
      <H>Tags that work</H>
      <ul className="space-y-2">
        <li>✅ <strong>NTAG213, NTAG215 or NTAG216</strong> stickers, cards or key fobs. These work on iPhone and Android. The type is usually in the product name.</li>
        <li>❌ <strong>MIFARE Classic</strong> doesn't work. It's common in cheap fobs and access cards, and iPhones can't read it.</li>
        <li>⚠️ <strong>Foil blister packs and metal tins</strong> block the signal. Use tags sold as <em>anti-metal</em> or <em>on-metal</em> there.</li>
        <li>⚠️ Tags must be <strong>blank or rewritable</strong>. Locked or pre-programmed tags can't be used. Only lock a tag (in NFC Tools) after you've written and tested it, if at all.</li>
      </ul>
      <H>Not just medications</H>
      <p>A tag can also {HAS_BODY ? <>add an exercise to your workout (stick it on the machine), start a routine, time cardio (tap at the start and again at the end), add water or protein, open Log weight, </> : null}open Log blood pressure or open a check-in. Link one from Settings → <strong>Tags</strong>{HAS_BODY ? <>, an exercise’s page, or a routine</> : null}; or tap a new tag and choose under <strong>Or use it for something else</strong>. Each tap shows what it will do with one button, so nothing is logged by accident.</p>
      <H>Writing a tag on Android</H>
      <p>Open a medication in Meds, tap <strong>Link a tag</strong>, then <strong>Write to tag</strong>, and hold the tag flat against the back of your phone until it says it's done.</p>
      <H>Writing a tag on iPhone</H>
      <p>Websites can't write tags on iPhone, so use the free <strong>NFC Tools</strong> app:</p>
      <ol className="list-decimal pl-5 space-y-1">
        <li>In {APP_NAME}, open the medication, tap <strong>Link a tag</strong>, then <strong>Copy link</strong>.</li>
        <li>Open NFC Tools and tap <strong>Write</strong>.</li>
        <li>Tap <strong>Add a record</strong> → <strong>URL / URI</strong>, paste the link, tap <strong>OK</strong>.</li>
        <li>Tap <strong>Write</strong> and hold the top of your iPhone near the tag.</li>
        <li>Back in {APP_NAME}, tap <strong>I've written the tag</strong>.</li>
      </ol>
      <p className="text-sm text-muted">Every tag link starts with {tagBase()}?t= followed by a code. The code means nothing on its own: if someone else taps your tag, their phone just shows “New tag found”.</p>
      <H>Tags that don't read</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>iPhone: the phone must be unlocked with the screen on. iPhones older than the XS need the Control Centre NFC reader.</li>
        <li>Android: NFC must be on (Settings → Connected devices → NFC).</li>
        <li>Phone cases with metal or magnets can block tags.</li>
        <li>As a backup, print a QR sticker from the tag's menu. The phone camera opens the same screen.</li>
      </ul>
    </>
  ),
  phones: (
    <>
      <H>The {APP_NAME} app</H>
      <p>There's also an installable app. It sends dose reminders, writes tags on iPhone and Android, and on Android a tag tap opens it even when it's closed.</p>
      <p><strong>Android:</strong> on your phone, open <a className="text-primary underline break-all" href={apkDownload}>{apkDownload.replace('https://', '')}</a> and open the downloaded {edition.apk}. Android asks you to allow installing from your browser the first time. Updates install over the top and keep your data.</p>
      <p>Tags written by the Android app open the app. Older tags, or ones written from the website, open Chrome instead. To fix one, open the medication in the app, tap the tag, then <strong>Test this tag</strong> → <strong>Update this tag</strong>. It stays linked.</p>
      <p><strong>iPhone:</strong> the app needs to be signed with an Apple Developer account before it can be installed (see NATIVE.md in {APP_NAME}'s code).</p>
      <p>The app keeps its own data. To move across, back up here (Settings → Backup and restore) and restore the file in the app. Or turn on family sync in both.</p>
      <H>iPhone</H>
      <p>Tag taps always open in <strong>Safari</strong>. On iPhone, apps added to the home screen keep their own separate data, so a dose logged from a tag wouldn't show up in the home-screen app.</p>
      <p><strong>So on iPhone, use {APP_NAME} in Safari.</strong> Add it to your Favourites or bookmark it instead of adding it to your home screen.</p>
      <p>Already using the home-screen app? Go to Settings → Backup and restore, back up, then restore the file in Safari.</p>
      <H>Android</H>
      <p>Install the app (Chrome menu → <strong>Install app</strong>). Tag taps should then open the installed app.</p>
      <p>If a tag opens a Chrome tab instead, open the Chrome menu on that tab and choose <strong>Open in {APP_NAME}</strong>, or keep using {APP_NAME} from Chrome. Your data is shared either way on Android.</p>
      <H>Keeping data safe</H>
      <p>Browsers can clear website data when a phone is short on space, and clearing browsing data removes it too. Back up regularly from Settings → Backup and restore.</p>
    </>
  ),
  reminders: isNative ? (
    <>
      <H>Dose reminders</H>
      <p>Turn on <strong>Remind me when doses are due</strong> in Settings. {APP_NAME} schedules a notification for each set time over the next week, and for the next dose of every-few-hours medications, from your own schedule. Logging a dose clears its reminder.</p>
      <p><strong>Log it</strong> on a reminder logs the planned amount without opening the app. Tap the reminder itself to check the amount first.</p>
      <p>Reminders show nicknames for medications that have one, so the lock screen doesn't reveal them.</p>
      <H>Nudges</H>
      <p>With <strong>Nudge me if I haven't logged it</strong> on, a second reminder comes when a dose still isn't logged a while after the time you usually take it. Days you often miss always get one.</p>
      <H>Reminders not arriving?</H>
      <p>Settings → Reminders → <strong>Reminder check</strong> shows what could stop or delay reminders on this phone (notifications off, battery saving), with a fix for each, and sends a test reminder.</p>
    </>
  ) : (
    <>
      <H>Why the calendar?</H>
      <p>{APP_NAME} can't send alerts by itself, so it adds the reminder to your phone's calendar. After you log a dose, tap <strong>Add to calendar</strong>. Your calendar app opens with an event at the next due time, set to alert you when it starts.</p>
      <p>Calendar reminders are one-off. Add one after each dose you want reminding about.</p>
    </>
  ),
  privacy: (
    <>
      <H>Your data stays on this phone</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>Everything you enter is saved on this device only.</li>
        <li>There are no accounts, no analytics and no tracking.</li>
        <li>After the app loads, it makes no network requests except checking for app updates from {tagBase()} (and, if you scan a label, downloading the label reader from the same place once).</li>
        <li>Nothing leaves the phone unless you export it (backups, spreadsheets, calendar events and printed reports) or turn on family sync, which encrypts everything first.</li>
        <li>Backup files are encrypted, so opening one (or a cloud drive or email preview) shows only scrambled text. Any copy of {APP_NAME} can restore them without a password, so treat them like the data itself: keep them somewhere private.</li>
        <li>Automatic backups (where the browser allows) only ever go to the folder you choose.</li>
        <li>{HAS_BODY ? 'Progress photos are stored on this phone and never uploaded. ' : ''}Label photos are read on the phone and not kept.</li>
        <li>Give a medication a <strong>nickname</strong> (on its page in Meds) and that's what shows on Today, when its tag is tapped, in calendar reminders and on Trends, with a plain grey icon. The real name only shows on the medication's own page, in the doctor report (you can choose nicknames there too) and in spreadsheet exports. For everything else, use the app lock.</li>
      </ul>
      <H>What could lose your data</H>
      <p>Clearing your browser's website data, deleting the app, or losing your phone without a backup. Back up regularly and keep the file somewhere safe.</p>
    </>
  ),
  lock: (
    <>
      <H>App lock</H>
      <p>The PIN is a privacy screen. It stops casual access on an unlocked phone. It doesn't encrypt the data on the phone.</p>
      <p>If you forget your PIN, the only way back in is to erase this phone's data and restore from a backup.</p>
    </>
  ),
  about: (
    <>
      <H>About {APP_NAME}</H>
      <p>{DISCLAIMER}</p>
      <p className="text-muted text-sm">It records what you do and shows back the limits you entered from your prescription. It never suggests doses or interprets how you feel.</p>
      <p className="text-muted text-sm">Version {import.meta.env.VITE_APP_VERSION ?? 'dev'}</p>
    </>
  ),
};
