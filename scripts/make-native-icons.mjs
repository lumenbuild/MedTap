// Generates the Android and iOS app icons, notification icon and splash screens from the web icon.
// Run after `npx cap add`: node scripts/make-native-icons.mjs
import sharp from 'sharp';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEAL = '#0B7A75';
const BG = '#F6F7F9';
const glyph = (stroke, fill) => `<rect x="150" y="214" width="150" height="84" rx="42" transform="rotate(-35 225 256)" fill="${fill}"/>`
  + `<g fill="none" stroke="${stroke}" stroke-width="28" stroke-linecap="round"><path d="M318 170a110 110 0 0 1 24 120"/><path d="M360 132a170 170 0 0 1 36 190" opacity=".6"/></g>`;
const svg = (body, bg = '') => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${bg}${body}</svg>`);
const scaled = (s, body) => `<g transform="translate(${256 - 256 * s} ${256 - 256 * s}) scale(${s})">${body}</g>`;

const square = svg(scaled(0.8, glyph('#fff', '#fff')), `<rect width="512" height="512" fill="${TEAL}"/>`);
const rounded = svg(scaled(0.8, glyph('#fff', '#fff')), `<rect width="512" height="512" rx="112" fill="${TEAL}"/>`);
const round = svg(scaled(0.7, glyph('#fff', '#fff')), `<circle cx="256" cy="256" r="256" fill="${TEAL}"/>`);
const foreground = svg(scaled(0.55, glyph('#fff', '#fff')));
const notification = svg(scaled(1.15, glyph('#fff', '#fff')));
const splashIcon = svg(scaled(1, glyph('#fff', '#fff')), `<rect width="512" height="512" rx="112" fill="${TEAL}"/>`);

const res = 'android/app/src/main/res';
if (existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    await sharp(rounded).resize(48 * k, 48 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher.png`);
    await sharp(round).resize(48 * k, 48 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher_round.png`);
    await sharp(foreground).resize(108 * k, 108 * k).png().toFile(`${res}/mipmap-${d}/ic_launcher_foreground.png`);
    const dir = `${res}/drawable-${d}`;
    if (!existsSync(dir)) (await import('node:fs')).mkdirSync(dir);
    await sharp(notification).resize(24 * k, 24 * k).png().toFile(`${dir}/ic_stat_medtap.png`);
  }
  writeFileSync(`${res}/values/ic_launcher_background.xml`,
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${TEAL}</color>\n</resources>\n`);
  for (const dir of readdirSync(res).filter((d) => d.startsWith('drawable'))) {
    const f = join(res, dir, 'splash.png');
    if (existsSync(f)) await splash(f);
  }
}

const ios = 'ios/App/App/Assets.xcassets';
if (existsSync(ios)) {
  await sharp(square).resize(1024, 1024).flatten({ background: TEAL }).removeAlpha().png().toFile(`${ios}/AppIcon.appiconset/AppIcon-512@2x.png`);
  const sp = `${ios}/Splash.imageset`;
  for (const f of readdirSync(sp).filter((x) => x.endsWith('.png'))) await splash(join(sp, f));
}

async function splash(file) {
  const { width, height } = await sharp(file).metadata();
  const size = Math.round(Math.min(width, height) * 0.28);
  const icon = await sharp(splashIcon).resize(size, size).png().toBuffer();
  const out = await sharp({ create: { width, height, channels: 3, background: BG } })
    .composite([{ input: icon, gravity: 'center' }]).png().toBuffer();
  writeFileSync(file, out);
}
