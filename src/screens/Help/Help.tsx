import type { ReactNode } from 'react';
import { Coffee, Utensils, BellRing, Sparkles, CalendarClock, ChevronRight, Compass, Info, Lock, Nfc, RefreshCw, ScanText, ShieldCheck, Smartphone, Syringe, Target, Users, Dumbbell } from 'lucide-react';
import { LOW_MG } from '../../logic/caffeine';
import { isNative, isNativeIOS } from '../../platform';
import { APP_NAME, DISCLAIMER } from '../../config';
import { tagBase } from '../../nfc/url';
import { Card } from '../../components/ui/Card';
import { HAS_BODY, HAS_TRAINING, HAS_FOOD, FOCUS, PLAY, HAS_PEPTIDES, HAS_VISITS, edition, apkDownload } from '../../edition';
import { FOCUS_HELP } from './HelpFocus';
import { useViewMode } from '../../app/viewMode';

// TapWeigh and TapLift have no medicines: their topics are listed in FOCUS_TOPIC_IDS and their own pages come from
// HelpFocus.tsx.
const ALL_TOPICS = [
  { id: 'start', title: 'Getting started', Icon: Compass },
  { id: 'schedules', title: 'Setting up a schedule', Icon: CalendarClock },
  { id: 'scan', title: 'Scanning a pharmacy label', Icon: ScanText },
  ...(HAS_BODY ? [{ id: 'goals', title: 'Goals and forecasts', Icon: Target }] as const : []),
  ...(HAS_TRAINING ? [{ id: 'training', title: 'Training and fitness', Icon: Dumbbell }] as const : []),
  ...(HAS_FOOD ? [{ id: 'food', title: 'Food and nutrition', Icon: Utensils }] as const : []),
  { id: 'caffeine', title: 'Caffeine', Icon: Coffee },
  { id: 'peptides', title: 'Peptides and injections', Icon: Syringe, peptides: true },
  { id: 'family', title: 'Family members', Icon: Users },
  { id: 'sync', title: 'Family sync', Icon: RefreshCw },
  { id: 'tags', title: FOCUS === 'meds' ? 'Which tags work' : 'Tags', Icon: Nfc },
  { id: 'phones', title: 'iPhone and Android', Icon: Smartphone },
  { id: 'reminders', title: FOCUS === 'meds' ? 'Reminders' : 'Check-ins and notifications', Icon: BellRing },
  { id: 'patterns', title: FOCUS === 'meds' ? 'Patterns and planning' : 'Trends', Icon: Sparkles },
  { id: 'privacy', title: 'Privacy', Icon: ShieldCheck },
  { id: 'lock', title: 'App lock', Icon: Lock },
  { id: 'about', title: `About ${APP_NAME}`, Icon: Info },
] as const;
const FOCUS_TOPIC_IDS = ['start', 'tags', 'goals', 'food', 'caffeine', 'training', 'reminders', 'patterns', 'family', 'sync', 'phones', 'privacy', 'lock', 'about'];
const TOPICS = FOCUS === 'meds' ? ALL_TOPICS : ALL_TOPICS.filter((t) => FOCUS_TOPIC_IDS.includes(t.id)).sort((a, b) => FOCUS_TOPIC_IDS.indexOf(a.id) - FOCUS_TOPIC_IDS.indexOf(b.id));

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
  const page = topics.some((t) => t.id === topic) ? (FOCUS !== 'meds' && topic in FOCUS_HELP ? FOCUS_HELP[topic] : CONTENT[topic]) : undefined;
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
        <p>{HAS_PEPTIDES ? 'Stack' : 'Meds'} → <strong>Add</strong>. Its name and strength, how much you usually take, and when: set times, every few hours, or as needed. Or tap <strong>Take photo</strong> to fill it in from the pharmacy label, then check it.</p>
        <p>Not every day? Choose certain days or every few days. A dose that changes over time? Use its <strong>Dose plan</strong>.</p>
      </Step>
      <Step n={2} title="Get tags and stick one on">
        <p>Any NTAG213 or NTAG215 NFC sticker works; they're cheap online. Stick one on the box, bottle or pen. On foil packs or metal tins, use tags sold as <em>on-metal</em>.</p>
      </Step>
      <Step n={3} title="Link the tag">
        <p>On the medicine's page, tap <strong>Link a tag</strong> and hold your phone on it.{isNativeIOS ? ' On iPhone, hold the top of the phone near the tag.' : ' On Android, the back of the phone, near the middle.'}</p>
        <p>One tag per medicine. A tag can also log a coffee, water, a check-in or a gym machine: {HAS_PEPTIDES ? 'Stack → Tools' : 'Meds'} → <strong>Tags</strong>.</p>
      </Step>
      <Step n={4} title="Log a dose">
        <p>Tap the tag: the dose is logged at your usual amount, with <strong>Undo</strong> for a few seconds. Tapped twice by mistake? {APP_NAME} asks before logging the same medicine again within a few minutes.</p>
        <p>No tag to hand? Tap <strong>Log dose</strong> on Today. Took it earlier? Change the time before saving. Missed it? Use <strong>Skip this dose</strong> so the plan stays right.</p>
      </Step>
      <Step n={5} title="Read Today">
        <p>The big number is your next dose. Below it: each medicine and whether it's done, as-needed medicines with when you last had them, and quick buttons for a check-in, blood pressure{HAS_BODY ? ', weight' : ''} and more.</p>
        <p>Notes appear only when they matter: stock running low, a script to renew, a pattern worth knowing.</p>
        <p>At the bottom, <strong>Logged today</strong> lists everything you logged. Tap a row to change or remove it; the arrows step back to earlier days.</p>
      </Step>
      <Step n={6} title="Check in">
        <p>A few taps on mood, focus, energy and anything you noticed. {APP_NAME} asks a while after a dose and at the times you choose each day (8 pm to start), opening the check-in by itself when the app is open and, on the phone app, with a notification. Change the times or turn either off in Settings → <strong>Check-ins</strong>. Trends sets check-ins against your doses, sleep and more: the more you do, the sharper the patterns.</p>
        <p>Short on time? Answer <strong>Good</strong>, <strong>OK</strong> or <strong>Rough</strong> right on the notification, or tap <strong>Same as usual</strong> at the top of the check-in to save your usual answers in one go.</p>
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
  food: (
    <>
      <H>Log food</H>
      <p>{FOCUS === 'weight' ? <>The <strong>Food</strong> tab → <strong>Log food</strong>, with the day's totals underneath.</> : <>Today → <strong>Food</strong> → <strong>Log food</strong>, or open Food for the day's totals. Turn it off in Settings if you don't want it.</>}</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Scan a barcode</strong>: point the camera at it and it's read as soon as it's in the frame (or take a photo, or type the numbers). It's looked up in Open Food Facts, a free open database (only the barcode number is sent), and everything on its panel is kept: energy, protein, carbs, sugars, fat, fibre, sodium, and micros like caffeine, B vitamins, calcium and iron. Check it against the pack the first time; after that it's saved on your phone and works offline.</li>
        <li><strong>Photo of the label</strong>: for anything the database doesn't have, photograph the nutrition panel. It's read on your phone, not uploaded, and you check the numbers before saving. Scanned first? The barcode is saved with it, so it's found next time.</li>
        <li><strong>Meal I made</strong>: hand portions, below.</li>
        <li><strong>Type it in</strong>: numbers from a menu or another app.</li>
      </ul>
      <p>Anything you log is saved to log again in one tap: your shake, your energy drink, your usual lunch. Star the ones you have most.</p>
      <H>Food you make, without weighing</H>
      <p>Use your hand as the measure. A <strong>palm</strong> of protein (its size and thickness), a <strong>cupped hand</strong> of carbs, a <strong>fist</strong> of veg, a <strong>thumb</strong> of fats. Tap how many of each and you get an estimate that's close enough to see the pattern over a week, which is what matters.</p>
      <p>Name a meal you make often and next time pick it and choose <strong>Smaller</strong>, <strong>Usual</strong> or <strong>Bigger</strong>. It's never the same twice, and it doesn't need to be.</p>
      <p>Cooking a batch? Food → <strong>New batch recipe</strong>: scan the packs or pick what you've saved, say how many serves, then log a serve each time. You enter it once.</p>
      <p>If you only get one number right, make it protein: it's the one that protects muscle while you lose weight. The rest can be rough.</p>
      {FOCUS === 'weight' && <p>Something you have often (a protein shake, a drink)? Put a tag on it: Settings → Tags → A food or drink, and one tap logs a serving.</p>}
      <H>Where it shows</H>
      <p>Protein from food adds to the protein on Today (and widgets, the watch and Trends). Caffeine from a drink adds to the caffeine on Today, with its amount, so the in-you estimate and Trends include it. Energy shows as Calories or kilojoules (Food → Energy), with a daily target if you set one.</p>
    </>
  ),
  caffeine: (
    <>
      <H>Log a drink</H>
      <p>Today → <strong>Coffee</strong>. Tap the drink and it's logged with its caffeine: your usual ones are at the top, then common coffees, teas, energy drinks and others. For anything else, type its name and mg once; after that it's one of your usual ones. <strong>Earlier?</strong> sets the time. Drinks scanned in Food count too.</p>
      <p>The amounts are typical. Café coffee varies a lot (from about 60 to over 200 mg a cup), so if you know yours, use your own number. Tap a drink in the timeline to change or remove it.</p>
      <H>On Today</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>The day's total against your own limit (Settings → <strong>Caffeine</strong>; 400 mg to start).</li>
        <li>About how much is still in you, as a curve through the day to your bedtime, and when it drops under {LOW_MG} mg.</li>
        <li><strong>Again</strong> logs the last drink once more.</li>
      </ul>
      <p>The estimate assumes it's absorbed over about an hour and that half is gone every few hours. That time varies a lot between people (about 3 to 8 hours or more), so set yours in Settings → Caffeine if the default feels off. It's an estimate, not a measurement.</p>
      <H>Same as usual?</H>
      <p>Once a drink is a habit (most days, at about the same time), Today asks <strong>Same as usual?</strong> with Yes and Not today, and the app sends the same question as a notification an hour after the usual time. Yes logs it at the usual time. Turn it off in Settings → Caffeine.</p>
      <H>Find your cut-off and limit</H>
      <p>Today's caffeine card → <strong>Find your cut-off and limit</strong> (or Settings → Caffeine). From your own days it shows how you slept by the time of your last drink, and how often you felt on edge (Jittery, Irritable and the like in a check-in) by how much you had. Where later drinks or bigger days are clearly worse, that's your cut-off or limit, and one tap puts it on Today.</p>
      <p>To gather the days, start a <strong>two-week check</strong>: each morning Today asks how you slept (one tap), and the card counts the days. It helps to have some days with your last drink early and some later, and some lighter and some heavier, within what you'd usually have. You can stop any time.</p>
      <H>In Trends</H>
      <p><strong>Daily habits</strong> → Caffeine: mg each day against your limit. <strong>What goes with what</strong> compares your sleep on nights with {LOW_MG} mg or more likely still in you at bedtime against the others, once there are a few of each.</p>
    </>
  ),
  training: (
    <>
      {FOCUS !== 'training' && <>
        <H>Turning it on</H>
        <p>Settings → <strong>Training</strong>. This adds a Training tab, protein and water on Today, and a soreness rating in check-ins. Turning it off hides them; nothing is deleted.</p>
      </>}
      <H>Your training path</H>
      <p>Training → <strong>Set up my plan</strong>: your goal (strength, muscle, general fitness or bodyweight), days a week, time, where you train, how much you've trained before, and whether to compare your strength with women's or men's standards. The app picks a programme for your level and writes each session; <strong>Start this session</strong> lays it out with the weights to use.</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Levels</strong> go Beginner, Novice, Intermediate, Advanced, Expert. Your level is the lowest of: weeks of regular training, strength for body weight on squat, bench, deadlift and press (if you compare), and for bodyweight training, how far along each ladder you are. The card shows what the next level needs.</li>
        <li><strong>Programmes</strong> change with level: a simple A/B session with weight added every time; then heavy, light and medium days; upper/lower; four-week waves from a training max; and twelve-week blocks. For muscle: full body, upper/lower, push/pull/legs, volume blocks and specialisation. Bodyweight follows ladders, from incline push-ups to one-arm push-ups.</li>
        <li><strong>Moving up</strong>: when your level passes the programme's, or most main lifts stop going up after its minimum weeks, Training says you're ready, with why, and one tap moves you on.</li>
        <li>Prefer a named programme? <strong>Programmes</strong> lists them all by goal and level.</li>
      </ul>
      <p className="text-sm text-muted">The strength standards are rough guides from widely shared tables, not targets. Training with an injury or a health condition: check with your doctor or a physio first.</p>
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
        <li><strong>Lean mass while losing weight</strong>: log body fat % or lean mass (Body → Add measurements or body fat) and it shows how much of the weight you've lost was lean mass<Pep>, by dose with peptide tools on</Pep>.</li>
        <Pep><li><strong>Strength and your peptide</strong>: each session against your recent level, by days since the shot and by dose.</li></Pep>
      </ul>
      <p>These are worked out from your own records. They're not a training programme or health advice.</p>
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
      <p><strong>The coming days</strong> (likely focus, mood and appetite, under How you've felt) and <strong>Last dose and sleep</strong> (the time after which sleep is usually worse, under What goes with what){HAS_VISITS ? <>, and <strong>Appt</strong> to compare with before your last appointment</> : null}.</p>
      <H>Reminders</H>
      <p>In the app, <strong>Nudge me if I haven't logged it</strong> sends a second reminder a while after your usual time.</p>
      {HAS_VISITS ? (
        <>
          <H>Appointments, lab results and trips</H>
          <p>Trends → <strong>Appointments</strong>: add appointments and questions, then print a one-page summary of what's changed since the last one. Lab results can be read from a photo of the printout. Meds → <strong>Trip</strong> shows dose times across time zones, switching straight away or moving 2 hours a day.</p>
        </>
      ) : (
        <>
          <H>Lab results</H>
          <p>{HAS_PEPTIDES ? 'Insights' : 'Trends'} → <strong>Lab results</strong> (under Records and tools): type them in or read them from a photo of the printout. They're in the doctor report.</p>
        </>
      )}
      <p>Check-in notes suggest chips (“bit queasy” → Nausea)<Pep>, and adding vials can read the lot and expiry from a photo of the label</Pep>.</p>
      <H>Streaks, milestones and your day</H>
      <p>Today's ring fills as you take your set doses, check in and reach your water and protein. Under it, your longest streak; tap for every streak, your best runs and the milestones you've reached (runs of days, workouts, personal bests and every 5 kg towards a weight goal). Streaks are forgiving: one off day in any week, or one off week in four for training, doesn't end them, and a dose skipped on purpose counts. Your week (last week against the week before, wins first) is at the top of Progress; on Monday to Wednesday Today has a line for it.</p>
      <H>For you</H>
      <p>Everything the app notices, in one list, most important first: a script to book, readings to raise, a plateau, today's wear-off, a genuine change, odd records, an appointment, a caffeine cut-off found in your sleep{HAS_BODY ? ', a calorie target from what you actually burn, protein to keep muscle, and muscle lost while losing weight' : ''}. Today shows the top two; Progress shows them all. Each says what it rests on and has one thing to do; × puts it away for a while. Do something from one (set a cut-off, a target) and a few weeks later it checks back on what happened.</p>
      {HAS_BODY && <>
        <H>Losing weight well, and keeping it off</H>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Calories</strong>: Food → Daily target → <strong>Worked out for me</strong>. From four weeks of food and weigh-ins, what you burn, and a target for the loss you choose (0 to keep your weight), updated each week.</li>
          <li><strong>Fibre</strong>: on Food, against a daily target. If constipation, nausea or reflux comes up more after low-fibre, low-water or big-meal days, an insight says so.</li>
          <li><strong>Hunger</strong>: when logging food, <strong>How hungry were you?</strong> and why (optional). Food → <strong>Why you eat</strong> shows how much is without real hunger, the usual reason, and whether short nights or low-protein days go with more of it.</li>
          <li><strong>Steps</strong>: a target a little above your usual, in today's ring once steps come in (or your own in Settings → Training). Sleep that swings night to night, and an optional stress rating in check-ins, are watched too.</li>
          <li><strong>After the loss</strong>: when your weight creeps up from its lowest (and why, if a dose came down or stopped), or you reach your goal, an insight offers to aim to keep it.</li>
          <li><strong>Health markers</strong> on Body: blood pressure, resting heart rate, waist-to-height and BMI (add your height), and lab results such as HbA1c and cholesterol, each against where it started.</li>
        </ul>
      </>}
      <H>How Trends is laid out</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>How you've felt</strong>: your check-ins, what you noticed most and the coming days, in one place.</li>
        <li><strong>Medicines</strong>: pick one, and every chart under it is about that medicine: doses per day, timing, effect window, <strong>days on and off</strong> (check-ins on days taken against days not) and <strong>heart rate after a dose</strong>.</li>
        <li><strong>Daily habits</strong>: pick {HAS_BODY ? 'food, protein, water, ' : ''}caffeine, steps, sleep, resting heart rate or HRV for one chart over the range.</li>
        <li><strong>What goes with what</strong>: last dose and sleep, caffeine still in you at bedtime and alcohol (tap Coffee or Alcohol on Today){HAS_BODY ? <>, steps and weight, readiness and lifts, protein and lean mass</> : null}, side by side.</li>
        {HAS_BODY && <li>Weight, measurements, goals and blood pressure are charted once, on <strong>Body</strong>.</li>}
      </ul>
      <H>Count what's left</H>
      <p>{HAS_PEPTIDES ? 'Stack' : 'Meds'} → <strong>Count what’s left</strong> (also on a medication's page, and on the Today card when stock is low): type the count, or for tablets and capsules take a photo of them in one layer on a plain surface (touching is fine; not stacked) (counted on the phone; the photo isn't kept). It compares with what your logs say should be left, and can log doses you took but didn't log.</p>
      <H>In the app</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Health Connect / Apple Health</strong> (Settings): read only; steps, sleep (with deep sleep and time awake) and heart rate{HAS_BODY ? ', weigh-ins' : ''} and blood pressure. Imports again when you open the app, at most once an hour. A watch's heart rate in 5-minute blocks shows how a stimulant dose rises and settles (on the medicine's page), sharpens the wear-off forecast and second-dose reminder, and shows resting heart rate through the week after a shot (Protocol).</li>
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
      <p>Stack → Tools → <strong>Supplies</strong>. Enter how many syringes, pen needles and swabs you have, and your water. They count down as you log injections and mix vials. The sharps container counts up, and Today reminds you when it's nearly full.</p>
      <p>Courses, on and off cycles, and stepping the dose when ready are in <a href="#/help/schedules" className="underline underline-offset-4">Setting up a schedule</a>.</p>
      <H>Titration</H>
      <p>Stack → the peptide → <strong>Plan</strong> → <strong>Change the plan</strong> → <strong>Steps on a schedule</strong>: the first dose, the step up (or down), how often, and the final dose. Each step switches over on its day, and it's marked on the weight chart.</p>
      <H>Charts</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Estimated level</strong>: enter a half-life on the medication and Trends estimates the amount in your body from your doses. It's a simple model on the figure you enter, not a measurement.</li>
        <li><strong>Dose levels</strong>: for each dose you've been on, your weight change, appetite and what you noted in check-ins. Settings can add common injection side effects to check-ins.</li>
      </ul>
      <H>Predictions (a peptide's Overview)</H>
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
      <H>Biohacking tools</H>
      <p>Settings → <strong>Biohacking tools</strong> turns these on (and off again) together:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>Brain test</strong> (Insights → Records and tools): 2 minutes (reaction time, then a working-memory round) or 30 seconds of reaction time, also on the watch. Shows your scores, your sharpest hours, and whether there's a real evening dip as a stimulant wears off. Every test is saved and shows in Logged today, and once you've done 5 it counts as a focus reading (placed against your own usual score) in your best dose and time, the effect window and the wear-off forecast.</li>
        <li><strong>Readiness</strong> on Today: sleep, heart rate, HRV, last night's late dose or drink and this morning's test, with a plan for the day, a warning when heart rate and HRV look like you're getting sick, and how long you usually take to recover.</li>
        <li><strong>Tolerance and breaks</strong> on a stimulant's page: whether the effect is shrinking, dose creep, planned breaks (no reminders on those days) and how strong the first doses back are.</li>
        <li><strong>Muscle protection</strong> on Body, and <strong>water, gut and appetite</strong> around a weekly shot on the peptide's Overview.</li>
        <li><strong>Journal</strong>, <strong>Experiments</strong> and <strong>Year in review</strong> (Insights → Records and tools), and <strong>Doctor mode</strong> on the report.</li>
        <li><strong>Watch</strong>: the tile and a ring complication show how far through today's stimulant you are; log focus or a symptom, or take the reaction test, from the wrist; a buzz before bed when it may still be working.</li>
      </ul>
      <H>Sleep</H>
      <p>Settings → <strong>Sleep</strong> adds a Sleep tab, built from your watch's nights (Health Connect): last night with a sleep score (how long, deep and REM, unbroken, usual timing and recovery, each part shown), tonight's bedtime for your target before your usual wake, sleep debt and how steady your times are, the last 30 nights by stage, and what goes with better or worse sleep in your own records: a late stimulant dose, caffeine after 2 pm, alcohol, sleep peptides, workouts and active days. Set your target at the bottom of the tab.</p>
      <H>Peptide guide</H>
      <p>Stack → Tools → <strong>Guide</strong>: retatrutide, glutathione, GHK-Cu, DSIP, BPC-157, NAD+, Semax and epitalon. What each one is, what the research shows and what people notice, a mixing table, how it’s taken and stored, the doses used, side effects, and when to get help. <strong>Set it up</strong> fills in the injection form, once or twice a week for retatrutide; change the dose to yours.</p>
      <H>Calculator</H>
      <p>Stack → Tools → <strong>Calculator</strong>: units for a dose, the dose for a number of units, or the water that makes your dose an easy number of units.</p>
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
        <li>On one phone: Settings → People and sync → <strong>Family sync</strong>. Enter your name and tap <strong>Start family sync</strong>.</li>
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
      <p>Go to Settings → People and sync → <strong>Add a family member</strong>. You start as “Me”, which you can rename.</p>
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
      <H>On and off</H>
      <p>In the schedule, <strong>Pattern</strong> → <strong>On and off</strong>: for example 4 weeks on, 12 weeks off, repeating. Off days aren't scheduled and send no reminders; Stack and each item's page show where you are (“On, week 3 of 4”).</p>
      <H>A course, then a break</H>
      <p><strong>Pattern</strong> → <strong>Course</strong>: for example {HAS_PEPTIDES ? '10 units' : 'a dose'} each night for 12 weeks, then off until it's needed again. After the last day nothing is scheduled. To be asked about starting again, add a word like <strong>Pain</strong>: it becomes a check-in chip, and when a check-in mentions it Today asks “Start another course?”. Or choose a number of weeks off. Nothing starts until you tap <strong>Start today</strong>.</p>
      <H>The dose plan</H>
      <p>Every way a dose changes is in one place, the <strong>Dose plan</strong> (on {HAS_PEPTIDES ? 'each item\'s page under Stack: Plan for a peptide, Overview for the rest' : 'the medication\'s page'}): what's been taken and what's planned on one ladder, the dated changes, and stepping when ready. <strong>Change the plan</strong> offers three ways: <strong>On a date</strong> (one change from a day you choose), <strong>Steps on a schedule</strong> (the same step every few weeks: a titration or a taper) and <strong>When I'm ready</strong>.</p>
      <H>Step the dose when ready</H>
      <p><strong>Dose plan</strong> → <strong>Change the plan</strong> → <strong>When I'm ready</strong>: how much each step is (in {HAS_PEPTIDES ? 'syringe units or ' : ''}the medication's unit), the least time on each dose, the most you'll go to (a dose or a week), and, if you like, conditions from your check-ins: appetite back to a level, side effects settled{HAS_BODY ? ', weight loss slowed' : ''}, no missed doses. For example: {HAS_PEPTIDES ? 'up 5 units every 4 weeks or more once appetite is back to 3 of 5, to at most 12 mg a week' : 'up 10 mg at least a week apart while side effects stay settled, to at most 70 mg a dose'}.</p>
      <p>When every condition is met, Today shows the next dose with <strong>Step up</strong> and <strong>Not yet</strong>. It never changes a dose by itself, and stops at your maximum. For steps on fixed dates instead, use <strong>On a date</strong> or <strong>Steps on a schedule</strong>. With a dated step{HAS_PEPTIDES ? ' for an injection' : ''}, the plan also ticks off whether you're ready for it (weeks on the dose, side effects, appetite{HAS_BODY ? ', weight loss slowing' : ''}, no missed doses), against conditions you can set.</p>
      <H>Set times with different amounts</H>
      <p>Each set time can have its own amount, such as 10 mg at 8 am and 5 mg at 1 pm. Leave an amount blank to use your usual dose.</p>
      <H>Instructions</H>
      <p>Each medication has an Instructions box. Anything typed there, by you, a carer, pharmacist or doctor, shows every time the tag is tapped or a dose is logged.</p>
      <H>When your prescription changes</H>
      <p>For a change starting today, edit the medication. {APP_NAME} asks whether to record it as a change on a date, so your charts show when it happened.</p>
      <p>For a change on a future date, or a taper in steps, use the <strong>Dose plan</strong> → <strong>Change the plan</strong>: <strong>On a date</strong> for one, <strong>Steps on a schedule</strong> for several. On each date {APP_NAME} switches to the new schedule by itself and records it.</p>
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
      <H>Reusing a tag</H>
      <p>A tag can be used again for something else. <strong>Tags</strong> → <strong>Erase a tag to reuse it</strong> (or on a tag's own page, <strong>Erase this tag</strong>), then hold it to your phone: it's wiped, and its link in {APP_NAME} goes with it. Your history stays. Then link it as new.</p>
      <p>Or skip erasing: link it straight to the new medicine and write over it. {APP_NAME} sees what was on it and drops the old link. Without NFC in this browser, erase it with NFC Tools (<strong>Other</strong> → <strong>Erase tag</strong>) and remove its link here.</p>
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
      {PLAY
        ? <p><strong>Android:</strong> get it from Google Play, which keeps it up to date.</p>
        : <p><strong>Android:</strong> on your phone, open <a className="text-primary underline break-all" href={apkDownload}>{apkDownload.replace('https://', '')}</a> and open the downloaded {edition.apk}. Android asks you to allow installing from your browser the first time. Updates install over the top and keep your data.</p>}
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
        <li>After the app loads, it makes no network requests except checking for app updates from {tagBase()} (and, if you scan a label, downloading the label reader from the same place once){HAS_FOOD ? '. Scanning a food barcode sends only that barcode number to Open Food Facts to look the product up; nothing about you goes with it' : ''}.</li>
        <li>Nothing leaves the phone unless you export it (backups, spreadsheets, calendar events and printed reports) or turn on family sync, which encrypts everything first.</li>
        <li>Backup files are encrypted, so opening one (or a cloud drive or email preview) shows only scrambled text. Any copy of {APP_NAME} can restore them without a password, so treat them like the data itself: keep them somewhere private.</li>
        <li>Automatic backups (where the browser allows) only ever go to the folder you choose.</li>
        <li>{HAS_BODY ? 'Progress photos are stored on this phone and never uploaded. ' : ''}Label photos{HAS_BODY ? ' and nutrition panels' : ''} are read on the phone and not kept.</li>
        <li>Give a medication a <strong>nickname</strong> (on its page in Meds) and that's what shows on Today, when its tag is tapped, in calendar reminders and on Trends, with a plain grey icon. The real name only shows on the medication's own page, in the doctor report (you can choose nicknames there too) and in spreadsheet exports. For everything else, use the app lock.</li>
      </ul>
      <H>What could lose your data</H>
      <p>Clearing your browser's website data, deleting the app, or losing your phone without a backup. Back up regularly and keep the file somewhere safe.</p>
      <p><a className="text-primary underline" href={`${tagBase()}privacy.html`}>The full privacy policy</a></p>
    </>
  ),
  lock: (
    <>
      <H>App lock</H>
      <p>The PIN is a privacy screen. It stops casual access on an unlocked phone. It doesn't encrypt the data on the phone.</p>
      <p>Settings → Privacy: choose how soon it locks after you leave the app, or tap <strong>Lock now</strong> before handing the phone over.</p>
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
