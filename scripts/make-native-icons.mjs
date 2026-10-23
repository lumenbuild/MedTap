// The app icon, everywhere it's needed, from one drawing: a capsule half taken (one half solid, one an outline, like
// the app's dose rings) with tap arcs off its tip, white on the app's ink. The arcs are the one colour and tell the
// two apps apart: teal for MedTap, violet for TapDose.
// Run: node scripts/make-native-icons.mjs (MedTap: web icons, Android, watch, iOS)
//      node scripts/make-native-icons.mjs tapdose (TapDose: web icons, Android and watch flavour resources)
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const tapdose = process.argv[2] === 'tapdose';
const INK = '#0A0A0A';
const ACCENT = tapdose ? '#A78BFA' : '#2DD4BF';
const SPLASH_BG = '#FFFFFF';

/** The mark on a 512 canvas, optically centred. `accent` colours the arcs (white for one-colour icons). */
const glyph = (accent, fg = '#fff') => {
  const cx = 230, cy = 290;
  const arc = (r) => `M ${(r * Math.cos(-0.8)).toFixed(2)} ${(r * Math.sin(-0.8)).toFixed(2)} A ${r} ${r} 0 0 1 ${(r * Math.cos(0.8)).toFixed(2)} ${(r * Math.sin(0.8)).toFixed(2)}`;
  return `<g transform="translate(-21 10)"><g transform="rotate(-40 ${cx} ${cy})">`
    + `<clipPath id="half"><rect x="${cx - 140}" y="${cy - 70}" width="140" height="140"/></clipPath>`
    + `<rect x="${cx - 122}" y="${cy - 56}" width="244" height="112" rx="56" fill="none" stroke="${fg}" stroke-width="20"/>`
    + `<rect x="${cx - 122}" y="${cy - 56}" width="244" height="112" rx="56" fill="${fg}" clip-path="url(#half)"/></g>`
    + `<g fill="none" stroke="${accent}" stroke-width="24" stroke-linecap="round" transform="translate(323 212) rotate(-40)">`
    + `<path d="${arc(62)}"/><path d="${arc(106)}" opacity=".55"/></g></g>`;
};
const svg = (body, bg = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${body}</svg>`;
const scaled = (s, body) => `<g transform="translate(${256 - 256 * s} ${256 - 256 * s}) scale(${s})">${body}</g>`;
const buf = (s) => Buffer.from(s);

// Shapes: a rounded tile (web, launchers), a full square (iOS, maskable: the system rounds it), a circle (round
// launchers, the watch), and the mark alone for adaptive foregrounds (inside the 66 dp safe circle) and notifications.
const rounded = svg(scaled(0.94, glyph(ACCENT)), `<rect width="512" height="512" rx="112" fill="${INK}"/>`);
const square = svg(scaled(0.94, glyph(ACCENT)), `<rect width="512" height="512" fill="${INK}"/>`);
const maskable = svg(scaled(0.8, glyph(ACCENT)), `<rect width="512" height="512" fill="${INK}"/>`);
const round = svg(scaled(0.8, glyph(ACCENT)), `<circle cx="256" cy="256" r="256" fill="${INK}"/>`);
const foreground = svg(scaled(0.66, glyph(ACCENT)));
const notification = svg(scaled(1.2, glyph('#fff')));

// Web (PWA) icons.
const web = tapdose ? 'public/icons/tapdose/' : 'public/icons/';
writeFileSync(`${web}icon.svg`, rounded);
writeFileSync(`${web}icon-maskable.svg`, maskable);
await sharp(buf(rounded)).resize(192, 192).png().toFile(`${web}icon-192.png`);
await sharp(buf(rounded)).resize(512, 512).png().toFile(`${web}icon-512.png`);
await sharp(buf(maskable)).resize(512, 512).png().toFile(`${web}maskable-512.png`);
await sharp(buf(square)).resize(180, 180).png().toFile(`${web}apple-touch-icon.png`);

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const main = 'android/app/src/main/res';
const res = tapdose ? 'android/app/src/tapdose/res' : main;
if (existsSync(main)) {
  for (const [d, k] of Object.entries(dens)) {
    mkdirSync(`${res}/mipmap-${d}`, { recursive: true });
    await sharp(buf(rounded)).resize(48 * k, 48 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher.png`);
    await sharp(buf(round)).resize(48 * k, 48 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher_round.png`);
    await sharp(buf(foreground)).resize(108 * k, 108 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher_foreground.png`);
    if (tapdose) continue; // the notification icon is white, so both apps share it
    const dir = `${res}/drawable-${d}`;
    mkdirSync(dir, { recursive: true });
    await sharp(buf(notification)).resize(24 * k, 24 * k).png().toFile(`${dir}/ic_stat_medtap.png`);
  }
  mkdirSync(`${res}/values`, { recursive: true });
  writeFileSync(`${res}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${INK}</color>\n</resources>\n`);
  // Splash screens: the same sizes as the main ones, the icon on white.
  for (const dir of readdirSync(main).filter((x) => x.startsWith('drawable'))) {
    const f = join(main, dir, 'splash.png');
    if (!existsSync(f)) continue;
    mkdirSync(join(res, dir), { recursive: true });
    await splash(f, join(res, dir, 'splash.png'));
  }
}

// Watch launcher (Wear OS shows it as a circle). The plain white pill stays for complications and tiles.
const wear = tapdose ? 'android/wear/src/tapdose/res' : 'android/wear/src/main/res';
if (existsSync('android/wear')) {
  for (const [d, k] of Object.entries(dens)) {
    mkdirSync(`${wear}/mipmap-${d}`, { recursive: true });
    await sharp(buf(round)).resize(48 * k, 48 * k).png().toFile(`${wear}/mipmap-${d}/ic_launcher.png`);
  }
}

const ios = 'ios/App/App/Assets.xcassets';
if (!tapdose && existsSync(ios)) {
  await sharp(buf(square)).resize(1024, 1024).flatten({ background: INK }).removeAlpha().png().toFile(`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`);
  const sp = `${ios}/Splash.imageset`;
  for (const f of readdirSync(sp).filter((x) => x.endsWith('.png'))) await splash(join(sp, f));
}

async function splash(file, out = file) {
  const { width, height } = await sharp(file).metadata();
  const size = Math.round(Math.min(width, height) * 0.28);
  const icon = await sharp(buf(rounded)).resize(size, size).png().toBuffer();
  const png = await sharp({ create: { width, height, channels: 3, background: SPLASH_BG } })
    .composite([{ input: icon, gravity: 'center' }]).png().toBuffer();
  writeFileSync(out, png);
}
