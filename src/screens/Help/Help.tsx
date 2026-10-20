import type { ReactNode } from 'react';
import { BellRing, CalendarClock, ChevronRight, Info, Lock, Nfc, RefreshCw, ScanText, ShieldCheck, Smartphone, Syringe, Users } from 'lucide-react';
import { isNative } from '../../platform';
import { APP_NAME, DISCLAIMER } from '../../config';
import { tagBase } from '../../nfc/url';
import { Card } from '../../components/ui/Card';

const TOPICS = [
  { id: 'schedules', title: 'Setting up a schedule', Icon: CalendarClock },
  { id: 'scan', title: 'Scanning a pharmacy label', Icon: ScanText },
  { id: 'peptides', title: 'Peptides and injections', Icon: Syringe },
  { id: 'family', title: 'Family members', Icon: Users },
  { id: 'sync', title: 'Family sync', Icon: RefreshCw },
  { id: 'tags', title: 'Which tags work', Icon: Nfc },
  { id: 'phones', title: 'iPhone and Android', Icon: Smartphone },
  { id: 'reminders', title: 'Reminders', Icon: BellRing },
  { id: 'privacy', title: 'Privacy', Icon: ShieldCheck },
  { id: 'lock', title: 'App lock', Icon: Lock },
  { id: 'about', title: `About ${APP_NAME}`, Icon: Info },
] as const;

export const helpTitle = (topic?: string) => TOPICS.find((t) => t.id === topic)?.title ?? 'Help';

export function Help({ topic }: { topic?: string }) {
  if (!topic) {
    return (
      <ul className="space-y-2">
        {TOPICS.map(({ id, title, Icon }) => (
          <li key={id}>
            <a href={`#/help/${id}`} className="bg-surface rounded-card shadow-card p-4 min-h-[56px] flex items-center gap-3">
              <Icon className="text-primary" aria-hidden="true" />
              <span className="flex-1 font-medium">{title}</span>
              <ChevronRight className="text-muted" aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
    );
  }
  return <Card className="space-y-4 help-prose">{CONTENT[topic] ?? <p>That help page doesn't exist.</p>}</Card>;
}

const H = ({ children }: { children: ReactNode }) => <h2 className="text-lg font-semibold">{children}</h2>;

const CONTENT: Record<string, ReactNode> = {
  peptides: (
    <>
      <H>Turning it on</H>
      <p>Settings → <strong>Peptides and injections</strong>. This adds vials you mix, syringe units, a calculator, titration plans and injection sites. Turning it off hides them again; nothing is deleted.</p>
      <H>A vial you mix</H>
      <ol className="list-decimal pl-5 space-y-1">
        <li>Add the medication with Form <strong>Injection</strong>, and tick <strong>I mix this from a powder vial</strong>.</li>
        <li>Enter the <strong>amount in each vial</strong> (e.g. 5 mg), the <strong>water</strong> you add (e.g. 2 mL), and your syringe (U-100 0.3 mL is common).</li>
        <li>Set the dose and schedule your prescriber gave you, as for any medication.</li>
      </ol>
      <p>Log dose then shows what to draw, e.g. <strong>10 units · 0.1 mL</strong> for 0.25 mg from 5 mg in 2 mL, on a picture of the syringe. You can also enter a dose in syringe units.</p>
      <p>Tap <strong>I've mixed a new vial</strong> on the medication's page each time you mix one. {APP_NAME} then counts what's left from the doses you log, and Today warns you when about one dose is left or the vial is past its use-within date. Stock counts whole vials.</p>
      <H>Calculator</H>
      <p>Settings → Peptides and injections → <strong>Peptide calculator</strong>. Work out the units for a dose, the dose for a number of units, or how much water makes your dose an easy number of units.</p>
      <H>Titration</H>
      <p>On the medication's page, <strong>Plan a titration</strong>: enter the first dose, how much it goes up (or down) each step, how often, and the final dose. Each step is saved as a planned change, switches over on its day and shows in your charts. Remove any step under Planned changes.</p>
      <H>Injection sites</H>
      <p>Log dose shows the injection sites, with the one used longest ago picked for you, to help you rotate. Change it with a tap. Sites show in the timeline and spreadsheet exports.</p>
      <H>Check your numbers</H>
      <p>{APP_NAME} only does sums on the numbers you enter; it doesn't suggest doses. Check the units against the label, your prescriber's directions or your pharmacist, especially the first time. Under 2 units is hard to measure accurately.</p>
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
      <p>Family sync shares {APP_NAME}'s records between your phones and your family's: medications, doses, check-ins, weight, blood pressure and tags. A dose logged on one phone shows on the others, and stock counts include doses logged on every phone. Photos and settings stay on each phone.</p>
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
      <p>Each person has their own medications, check-ins, weight, measurements, blood pressure, photos, charts and doctor report. Choose who to show with the names at the top of Today, Trends, Body and Meds.</p>
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
      <p><strong>Android:</strong> download MedTap.apk from github.com/lumenbuild/MedTap/releases on your phone and open it. Android asks you to allow installing from your browser the first time.</p>
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
        <li>Progress photos are stored on this phone and never uploaded. Label photos are read on the phone and not kept.</li>
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
