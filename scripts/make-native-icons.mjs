// The app icon, everywhere it's needed, from one drawing: white on the app's ink with tap arcs off it in the app's one
// colour. MedTap (teal) and TapDose (violet) are a capsule half taken (one half solid, one an outline, like the app's
// dose rings); TapWeigh (amber) is a bathroom scale; TapLift (sky blue) a dumbbell.
// Run: node scripts/make-native-icons.mjs (MedTap: web icons, Android, watch, iOS)
//      node scripts/make-native-icons.mjs tapdose|tapweigh|taplift (web icons, Android flavour resources, and the
//      watch for TapDose)
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const app = ['tapdose', 'tapweigh', 'taplift'].includes(process.argv[2]) ? process.argv[2] : 'medtap';
const tapdose = app !== 'medtap'; // a flavour of the Android app (MedTap is the main one)
const INK = '#0A0A0A';
const ACCENT = { medtap: '#2DD4BF', tapdose: '#A78BFA', tapweigh: '#FBBF24', taplift: '#38BDF8' }[app];
const SPLASH_BG = '#FFFFFF';

/** The mark on a 512 canvas, optically centred. `accent` colours the arcs (white for one-colour icons). */
const arc = (r) => `M ${(r * Math.cos(-0.8)).toFixed(2)} ${(r * Math.sin(-0.8)).toFixed(2)} A ${r} ${r} 0 0 1 ${(r * Math.cos(0.8)).toFixed(2)} ${(r * Math.sin(0.8)).toFixed(2)}`;
const arcs = (accent, x, y, rot) => `<g fill="none" stroke="${accent}" stroke-width="24" stroke-linecap="round" transform="translate(${x} ${y}) rotate(${rot})">`
  + `<path d="${arc(62)}"/><path d="${arc(106)}" opacity=".55"/></g>`;
const capsule = (accent, fg = '#fff') => {
  const cx = 230, cy = 290;
  return `<g transform="translate(-21 10)"><g transform="rotate(-40 ${cx} ${cy})">`
    + `<clipPath id="half"><rect x="${cx - 140}" y="${cy - 70}" width="140" height="140"/></clipPath>`
    + `<rect x="${cx - 122}" y="${cy - 56}" width="244" height="112" rx="56" fill="none" stroke="${fg}" stroke-width="20"/>`
    + `<rect x="${cx - 122}" y="${cy - 56}" width="244" height="112" rx="56" fill="${fg}" clip-path="url(#half)"/></g>`
    + arcs(accent, 323, 212, -40) + `</g>`;
};
// A bathroom scale from above: the platform with its dial and needle, arcs off a corner.
const scale = (accent, fg = '#fff') => `<g transform="translate(-14 26)">`
  + `<rect x="96" y="176" width="236" height="236" rx="60" fill="none" stroke="${fg}" stroke-width="20"/>`
  + `<path d="M 152 296 A 62 62 0 0 1 276 296" fill="none" stroke="${fg}" stroke-width="18" stroke-linecap="round"/>`
  + `<path d="M 214 296 L 248 252" stroke="${fg}" stroke-width="18" stroke-linecap="round"/>`
  + `<circle cx="214" cy="296" r="15" fill="${fg}"/>`
  + arcs(accent, 352, 156, -45) + `</g>`;
// A dumbbell on the same slant as the capsule: two plates each end, one end solid and one an outline (like the dose
// rings), arcs off its tip.
const dumbbell = (accent, fg = '#fff') => {
  const cx = 222, cy = 296;
  const plate = (x, w, h, solid) => `<rect x="${x}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${w / 2.6}"`
    + (solid ? ` fill="${fg}"/>` : ` fill="none" stroke="${fg}" stroke-width="14"/>`);
  return `<g transform="translate(-14 4)"><g transform="rotate(-40 ${cx} ${cy})">`
    + `<rect x="${cx - 84}" y="${cy - 12}" width="168" height="24" rx="12" fill="${fg}"/>`
    + plate(cx - 108, 24, 96, true) + plate(cx - 150, 38, 150, true)
    + plate(cx + 91, 24, 96, false) + plate(cx + 122, 38, 150, false)
    + `</g>` + arcs(accent, 340, 200, -40) + `</g>`;
};
const glyph = { medtap: capsule, tapdose: capsule, tapweigh: scale, taplift: dumbbell }[app];
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
const web = tapdose ? `public/icons/${app}/` : 'public/icons/';
mkdirSync(web, { recursive: true });
writeFileSync(`${web}icon.svg`, rounded);
writeFileSync(`${web}icon-maskable.svg`, maskable);
await sharp(buf(rounded)).resize(192, 192).png().toFile(`${web}icon-192.png`);
await sharp(buf(rounded)).resize(512, 512).png().toFile(`${web}icon-512.png`);
await sharp(buf(maskable)).resize(512, 512).png().toFile(`${web}maskable-512.png`);
await sharp(buf(square)).resize(180, 180).png().toFile(`${web}apple-touch-icon.png`);

const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const main = 'android/app/src/main/res';
const res = tapdose ? `android/app/src/${app}/res` : main;
if (existsSync(main)) {
  for (const [d, k] of Object.entries(dens)) {
    mkdirSync(`${res}/mipmap-${d}`, { recursive: true });
    await sharp(buf(rounded)).resize(48 * k, 48 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher.png`);
    await sharp(buf(round)).resize(48 * k, 48 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher_round.png`);
    await sharp(buf(foreground)).resize(108 * k, 108 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher_foreground.png`);
    if (app === 'tapdose') continue; // a white capsule either way, so TapDose shares MedTap's notification icon
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
// Only MedTap and TapDose have a watch app.
const wear = tapdose ? `android/wear/src/${app}/res` : 'android/wear/src/main/res';
if (existsSync('android/wear') && (app === 'medtap' || app === 'tapdose')) {
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
