// Generates PNG icons from public/icons/icon.svg. Run: node scripts/make-icons.mjs
// TapDose's (public/icons/tapdose/, made from its violet SVGs): node scripts/make-icons.mjs tapdose
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const out = process.argv[2] === 'tapdose' ? 'public/icons/tapdose/' : 'public/icons/';
const svg = readFileSync(out + 'icon.svg');
const maskable = readFileSync(out + 'icon-maskable.svg');
await sharp(svg).resize(192, 192).png().toFile(out + 'icon-192.png');
await sharp(svg).resize(512, 512).png().toFile(out + 'icon-512.png');
await sharp(maskable).resize(512, 512).png().toFile(out + 'maskable-512.png');
await sharp(maskable).resize(180, 180).png().toFile(out + 'apple-touch-icon.png');
