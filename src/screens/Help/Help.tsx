import type { ReactNode } from 'react';
import { BellRing, CalendarClock, ChevronRight, Info, Lock, Nfc, ShieldCheck, Smartphone, Users } from 'lucide-react';
import { APP_NAME, DISCLAIMER } from '../../config';
import { tagBase } from '../../nfc/url';
import { Card } from '../../components/ui/Card';

const TOPICS = [
  { id: 'schedules', title: 'Setting up a schedule', Icon: CalendarClock },
  { id: 'family', title: 'Family members', Icon: Users },
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
  family: (
    <>
      <H>Tracking for more than one person</H>
      <p>Go to Settings → Family members → <strong>Add a family member</strong>. You start as “Me”, which you can rename.</p>
      <p>Each person has their own medications, check-ins, weight, measurements, photos, charts and doctor report. Choose who to show with the names at the top of Today, Trends, Body and Meds.</p>
      <p>On Today, <strong>Everyone</strong> shows every person's medications at once, each card labelled with whose it is. Handy when you're giving doses to several people.</p>
      <H>Tags</H>
      <p>A tag always belongs to one person's medication. When it's tapped, the screen says <strong>For Sam</strong> (or whoever) in large text, so a dose is never logged against the wrong person. Calendar reminders include the name too.</p>
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
      <H>Refills</H>
      <p>Add how many you have and, optionally, your repeats and script expiry date. {APP_NAME} works out when you'll run out from your schedule (or your recent use for as-needed medications) and shows a card on Today a few days before. Tap <strong>Add stock</strong> when you pick up a refill.</p>
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
  reminders: (
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
        <li>After the app loads, it makes no network requests except checking for app updates from {tagBase()}.</li>
        <li>Nothing leaves the phone unless you export it: backups, spreadsheets, calendar events and printed reports.</li>
        <li>Backup files are encrypted, so opening one (or a cloud drive or email preview) shows only scrambled text. Any copy of {APP_NAME} can restore them without a password, so treat them like the data itself: keep them somewhere private.</li>
        <li>Automatic backups (where the browser allows) only ever go to the folder you choose.</li>
        <li>Progress photos are stored on this phone and never uploaded.</li>
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
