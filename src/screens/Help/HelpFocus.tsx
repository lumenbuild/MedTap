// Help for the apps without medicines: TapWeigh (weight, measurements, goals, food) and TapLift (training). The topics
// that are the same everywhere (goals, food, training, app lock) come from Help.tsx; these replace the ones that talk
// about medicines.
import type { ReactNode } from 'react';
import { APP_NAME } from '../../config';
import { FOCUS, HAS_FOOD, PLAY, apkDownload, edition } from '../../edition';
import { tagBase } from '../../nfc/url';
import { isNative } from '../../platform';

const H = ({ children }: { children: ReactNode }) => <h2 className="text-sm font-medium text-muted">{children}</h2>;
const weight = FOCUS === 'weight';

/** What the app's tags are for, in one line. */
const TAGS = weight
  ? 'the scales (opens Log weight), your tape measure (opens Add measurements), a food or drink you have often (logs one serving), the blood pressure cuff, or your bedside (opens a check-in)'
  : 'your gym bag (starts a routine), a machine or rack (adds that exercise, set out at what to aim for), the treadmill or bike (times cardio: tap at the start and the end), your water bottle or shaker (adds that much water or protein), the scales, or your bedside (opens a check-in)';

export const FOCUS_HELP: Record<string, ReactNode> = {
  start: (
    <>
      <H>Getting started</H>
      <ol className="list-decimal pl-5 space-y-1">
        {weight ? (
          <>
            <li>Settings → <strong>Tags</strong> → <strong>Link a new tag</strong> → <strong>Scales</strong>, then hold your phone on the sticker. Stick it on or beside your scales.</li>
            <li>Weigh in, tap the tag, and enter the number. Weigh at the same time each day, ideally in the morning before eating.</li>
            <li>On Body, tap <strong>Set a goal</strong> to see when you'll likely reach it.</li>
            {HAS_FOOD && <li>Log food from the Food tab: scan a barcode, photo a label, or estimate a meal by hand portions.</li>}
          </>
        ) : (
          <>
            <li>Training → <strong>Routines</strong>: make the workouts you do (or start with an empty one).</li>
            <li>Settings → <strong>Tags</strong> → <strong>Link a new tag</strong>: put one on your gym bag (a routine) and on the machines and racks you use most (an exercise).</li>
            <li>At the gym, tap the tag. The workout starts, or the exercise is added, laid out at what to aim for. Tick sets as you go and the rest timer starts itself.</li>
          </>
        )}
        <li>Each evening {APP_NAME} asks how the day went. A few taps on energy, sleep and anything you noticed{weight ? '' : ' (soreness too)'} make Trends far more useful.</li>
      </ol>
      <p>Everything stays on this phone. Back up from Settings → Backup and restore now and then, or turn on automatic backups.</p>
    </>
  ),
  tags: (
    <>
      <H>What a tag can do</H>
      <p>Stick one on {TAGS}. Link it from Settings → <strong>Tags</strong>, or tap a new tag and choose what it does. Each tap shows what it will do with one button, so nothing is logged by accident.</p>
      <H>Tags that work</H>
      <ul className="space-y-2">
        <li>✅ <strong>NTAG213, NTAG215 or NTAG216</strong> stickers, cards or key fobs. These work on iPhone and Android. The type is usually in the product name.</li>
        <li>❌ <strong>MIFARE Classic</strong> doesn't work. It's common in cheap fobs and access cards, and iPhones can't read it.</li>
        <li>⚠️ <strong>Metal</strong> ({weight ? 'tins, metal scales' : 'gym equipment'}) blocks the signal. Use tags sold as <em>anti-metal</em> or <em>on-metal</em> there.</li>
        <li>⚠️ Tags must be <strong>blank or rewritable</strong>. Locked or pre-programmed tags can't be used.</li>
      </ul>
      <H>Writing a tag</H>
      <p>On Android, the app writes the tag when you link it: hold the tag flat against the back of your phone until it says it's done. On iPhone, copy the tag's link and write it with the free <strong>NFC Tools</strong> app (Write → Add a record → URL / URI).</p>
      <p className="text-sm text-muted">Every tag link starts with {tagBase()}?t= followed by a code. The code means nothing on its own: if someone else taps your tag, their phone just shows “New tag found”.</p>
      <H>Tags that don't read</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>The phone must be unlocked with the screen on, and on Android NFC must be on (Settings → Connected devices → NFC).</li>
        <li>Phone cases with metal or magnets can block tags.</li>
        <li>As a backup, print a QR sticker from the tag's menu. The phone camera opens the same screen.</li>
      </ul>
    </>
  ),
  phones: (
    <>
      <H>The {APP_NAME} app</H>
      {PLAY
        ? <p>Updates come from Google Play. Tag taps open the app straight away, even when it's closed.</p>
        : <p><strong>Android:</strong> open <a className="text-primary underline break-all" href={apkDownload}>{apkDownload.replace('https://', '')}</a> and open the downloaded {edition.apk}. Updates install over the top and keep your data.</p>}
      <p>The app keeps its own data. To move to a new phone, back up (Settings → Backup and restore) and restore the file there.</p>
      <H>On the web</H>
      <p>On iPhone, use {APP_NAME} in Safari: tag taps always open there, and home-screen apps keep separate data. On Android, install it from the Chrome menu → <strong>Install app</strong>.</p>
    </>
  ),
  family: (
    <>
      <H>More than one person</H>
      <p>Settings → People and sync → <strong>Add a family member</strong>. Each person has their own {weight ? 'weigh-ins, measurements, goals, food,' : 'workouts, routines, bests, weigh-ins,'} check-ins and charts. Choose who to show with the names at the top of each tab.</p>
      <p>A tag belongs to one person: when it's tapped, the screen says who it's for in large text.</p>
    </>
  ),
  sync: (
    <>
      <H>Keep phones the same</H>
      <p>Family sync shares {APP_NAME}'s records between your phones: {weight ? 'weigh-ins, measurements, food,' : 'workouts, routines, weigh-ins,'} check-ins and tags, encrypted on the phone with a key only your phones have. Settings → People and sync → <strong>Family sync</strong> to start, then invite the other phone with its QR code.</p>
      <p>If two phones change the same thing before syncing, the later change wins.</p>
    </>
  ),
  reminders: (
    <>
      <H>Check-ins</H>
      <p>{APP_NAME} asks how the day went at the times you choose (8 pm to start): the check-in opens by itself when the app is open{isNative ? ', and a notification comes if it isn’t' : ''}. Change the times in Settings → <strong>Check-ins</strong>.</p>
      {!weight && <><H>Training days</H><p>Once you've a usual pattern, {APP_NAME} can remind you on the days you usually train. Turn it on from the card on Training.</p></>}
      <H>Your week</H>
      <p>Monday to Wednesday, Today shows last week against the week before. Tap <strong>Remind me each Monday</strong> for a notification.</p>
    </>
  ),
  patterns: (
    <>
      <H>Trends</H>
      <ul className="list-disc pl-5 space-y-1">
        <li><strong>How you've felt</strong>: your check-ins, what you noticed most and the likely coming days.</li>
        <li><strong>Daily habits</strong>: pick {weight ? 'food, ' : 'protein, water, readiness, '}steps, sleep, resting heart rate or HRV for one chart over the range, against your own target and the time before.</li>
        <li><strong>What goes with what</strong>: caffeine and alcohol against sleep, steps against weight{weight ? '' : ', readiness against lifts, protein against lean mass'}, side by side.</li>
        <li>{weight ? 'Weight, measurements, goals and blood pressure' : 'Weight, body fat and lean mass'} are on <strong>Body</strong>, each charted once.</li>
      </ul>
      <p>Steps, sleep and heart rate come from Health Connect (Settings → Health data), read only.</p>
      <p>These are patterns in your own records, not causes, and not advice.</p>
    </>
  ),
  privacy: (
    <>
      <H>Your data stays on this phone</H>
      <ul className="list-disc pl-5 space-y-1">
        <li>Everything you enter is saved on this device only. There are no accounts, no analytics and no tracking.</li>
        {weight && <li>Scanning a food barcode sends only that barcode number to Open Food Facts to look the product up; nothing about you goes with it. Nutrition panels are read on the phone and not kept.</li>}
        {weight && <li>Progress photos are stored on this phone and never uploaded.</li>}
        <li>Nothing leaves the phone unless you export it (backups, spreadsheets) or turn on family sync, which encrypts everything first.</li>
        <li>Backup files are encrypted, so opening one shows only scrambled text. Keep them somewhere private.</li>
      </ul>
      <H>What could lose your data</H>
      <p>Deleting the app or losing your phone without a backup. Back up regularly and keep the file somewhere safe.</p>
      <p><a className="text-primary underline" href={`${tagBase()}privacy.html`}>The full privacy policy</a></p>
    </>
  ),
  about: (
    <>
      <H>About {APP_NAME}</H>
      <p>{APP_NAME} is a personal record-keeping tool. It doesn't give medical, dietary or training advice: talk to your GP before big changes to how you eat or exercise.</p>
      <p className="text-muted text-sm">Version {import.meta.env.VITE_APP_VERSION ?? 'dev'}</p>
    </>
  ),
};
