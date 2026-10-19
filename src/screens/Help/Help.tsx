import type { ReactNode } from 'react';
import { BellRing, ChevronRight, Info, Lock, Nfc, ShieldCheck, Smartphone } from 'lucide-react';
import { APP_NAME, DISCLAIMER } from '../../config';
import { tagBase } from '../../nfc/url';
import { Card } from '../../components/ui/Card';

const TOPICS = [
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
        <li>Progress photos are stored on this phone and never uploaded.</li>
      </ul>
      <H>What could lose your data</H>
      <p>Clearing your browser's website data, deleting the app, or losing your phone without a backup. Back up regularly and keep the file somewhere safe.</p>
    </>
  ),
  lock: (
    <>
      <H>App lock</H>
      <p>The PIN is a privacy screen. It stops casual access on an unlocked phone. It doesn't encrypt your data, and backups are not encrypted.</p>
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
