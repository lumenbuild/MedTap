// Google Play graphics for TapDose, TapWeigh and TapLift: 6 captioned phone screenshots (1080×1920 JPEG), the 512×512
// icon and the 1024×500 feature graphic, into the repo's store/<app>/, from each app filled with sample data (seed.mjs).
// Run from the repo root, with the three websites built and served under SITE (default localhost:4190/MedTap/):
//   for e in tapdose tapweigh taplift; do VITE_EDITION=$e npx vite build --base /MedTap/$e/ --outDir site/MedTap/$e; done
//   python3 -m http.server 4190 --directory site &   then   node scripts/store/make-store-graphics.mjs [app]
// Play wants the feature graphic without transparency: flatten it afterwards if your tools add an alpha channel.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { seedDose, seedFocus } from './seed.mjs';
const ROOT = process.cwd();
const SITE = process.env.SITE || 'http://localhost:4190/MedTap/';
const only = process.argv[2];
const APPS = {
  tapdose: { name: 'TapDose', accent: '#A78BFA', tagline: 'Tap a tag. The dose is logged.', shots: [
    ['Tap the tag on your medicine.', 'It’s logged, with the time.', async (p, B) => { await p.goto(B + '?t=tvyv'); }],
    ['What’s due and what’s done,', 'at a glance.', async (p, B) => { await p.goto(B + '#/today'); }],
    ['See when it works', 'and when it wears off.', async (p, B) => { await p.goto(B + '#/trends'); await p.waitForTimeout(1200); await scrollTo(p, 'Effect window'); }],
    ['Check in with', 'a few taps.', async (p, B) => { await p.goto(B + '#/today'); await p.waitForTimeout(900); await p.getByRole('button', { name: 'Check in' }).first().click(); }],
    ['Know when you’ll run out,', 'before you do.', async (p, B) => { await p.goto(B + '#/meds'); }],
    ['Ready for your next', 'appointment.', async (p, B) => { await p.goto(B + '#/appointments/summary'); await p.waitForTimeout(800); await p.evaluate(() => window.scrollTo(0, 0)); }],
  ] },
  tapweigh: { name: 'TapWeigh', accent: '#FBBF24', tagline: 'Tap your scales. Weigh-in logged.', shots: [
    ['Tap the tag on your scales.', 'Your weigh-in is logged.', async (p, B) => { await p.goto(B + '#/tag/tgscales'); await p.waitForTimeout(2500); await p.getByRole('dialog').getByLabel(/^Weight/).fill('90.4'); await p.waitForTimeout(300); }],
    ['Your weight, the trend', 'and your goal.', async (p, B) => { await p.goto(B + '#/today'); }],
    ['See where it’s heading,', 'past the daily ups and downs.', async (p, B) => { await p.goto(B + '#/body'); }],
    ['Scan a barcode, or estimate', 'a meal by hand portions.', async (p, B) => { await p.goto(B + '#/food'); }],
    ['Tag your shake.', 'One tap logs it.', async (p, B) => { await p.goto(B + '?t=tgshake'); }],
    ['Find what helps,', 'in your own records.', async (p, B) => { await p.goto(B + '#/trends'); await p.waitForTimeout(1200); await scrollTo(p, 'Daily habits'); }],
  ] },
  taplift: { name: 'TapLift', accent: '#38BDF8', tagline: 'Tap the machine. Your sets are ready.', shots: [
    ['Tap the tag on the machine.', 'Your target is ready.', async (p, B) => { await p.goto(B + '?t=tgbench'); }],
    ['How ready you are,', 'before you start.', async (p, B) => { await p.goto(B + '#/today'); }],
    ['Sessions, streaks', 'and goals.', async (p, B) => { await p.goto(B + '#/training'); }],
    ['Every lift,', 'every personal best.', async (p, B) => { await p.goto(B + '#/training/exercise/bench'); }],
    ['Weight, body fat and', 'lean mass, together.', async (p, B) => { await p.goto(B + '#/body'); await p.waitForTimeout(800); await p.evaluate(() => window.scrollTo(0, 0)); }],
    ['Sets laid out at what', 'to aim for today.', async (p, B) => { await p.goto(B + '?t=tgbench'); await p.waitForTimeout(1200); await p.getByRole('button', { name: /Start a workout with it|Add to my workout|Open the workout/ }).click(); }, 2],
  ] },
};

async function scrollTo(p, text) {
  await p.getByText(text, { exact: true }).first().evaluate((el) => { el.scrollIntoView({ block: 'start' }); window.scrollBy(0, -150); });
}

const browser = await chromium.launch();
for (const [id, app] of Object.entries(APPS)) {
  if (only && only !== id) continue;
  const B = `${SITE}${id}/`;
  const out = `${ROOT}/store/${id}`;
  mkdirSync(`${out}/screenshots`, { recursive: true });
  // The app at a phone's size, 3× for sharp text.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, timezoneId: 'Australia/Sydney', locale: 'en-AU', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  if (id === 'tapdose') await seedDose(page, B); else await seedFocus(page, B, id);
  const raw = [];
  for (const [, , go] of app.shots) {
    await go(page, B); await page.waitForTimeout(1600);
    raw.push((await page.screenshot()).toString('base64'));
  }
  await ctx.close();
  // Compose: the caption on the app's ink, the screen below in a rounded frame.
  const comp = await (await browser.newContext({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })).newPage();
  // A shot's optional 4th item is where it goes in the listing (captured last, so it doesn't change the others).
  const order = app.shots.map((s, i) => ({ i, pos: s[3] ?? 0 }));
  const sorted = [...order.filter((o) => !o.pos)];
  for (const o of order.filter((o) => o.pos)) sorted.splice(o.pos - 1, 0, o);
  for (let k = 0; k < sorted.length; k++) {
    const i = sorted[k].i;
    const [a, b] = app.shots[i];
    await comp.setContent(`<!doctype html><html><head><style>
      body { margin: 0; width: 1080px; height: 1920px; background: #0A0A0A; font-family: Inter, system-ui, sans-serif; overflow: hidden; }
      .cap { position: absolute; top: 120px; left: 90px; right: 90px; color: #fff; font-size: 66px; line-height: 1.12; font-weight: 600; letter-spacing: -0.02em; }
      .cap span { color: ${app.accent}; }
      .phone { position: absolute; top: 470px; left: 110px; width: 860px; height: 1560px; border-radius: 64px; overflow: hidden; border: 10px solid #262626; background: #fff; }
      .phone img { width: 100%; display: block; }
    </style></head><body><div class="cap">${a}<br><span>${b}</span></div><div class="phone"><img src="data:image/png;base64,${raw[i]}"></div></body></html>`);
    await comp.waitForTimeout(150);
    writeFileSync(`${out}/screenshots/${k + 1}.jpg`, await comp.screenshot({ type: 'jpeg', quality: 88 }));
  }
  // Icon (512, from the app's own) and the feature graphic.
  const icon = readFileSync(`${ROOT}/public/icons/${id}/icon-512.png`).toString('base64');
  writeFileSync(`${out}/icon-512.png`, readFileSync(`${ROOT}/public/icons/${id}/icon-512.png`));
  const fg = await (await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 })).newPage();
  await fg.setContent(`<!doctype html><html><head><style>
    body { margin: 0; width: 1024px; height: 500px; background: #0A0A0A; font-family: Inter, system-ui, sans-serif; display: flex; align-items: center; gap: 56px; padding: 0 80px; box-sizing: border-box; overflow: hidden; }
    img { width: 220px; height: 220px; border-radius: 48px; }
    h1 { color: #fff; font-size: 84px; margin: 0; letter-spacing: -0.03em; font-weight: 700; }
    p { color: ${app.accent}; font-size: 38px; margin: 12px 0 0; font-weight: 500; line-height: 1.2; }
  </style></head><body><img src="data:image/png;base64,${icon}"><div><h1>${app.name}</h1><p>${app.tagline}</p></div></body></html>`);
  writeFileSync(`${out}/feature-graphic.png`, await fg.screenshot({ type: 'png' }));
  console.log('✓', id);
}
await browser.close();
