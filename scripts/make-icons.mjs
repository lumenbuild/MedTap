// Generates PNG icons from public/icons/icon.svg. Run: node scripts/make-icons.mjs
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg');
const maskable = readFileSync('public/icons/icon-maskable.svg');
const out = 'public/icons/';
await sharp(svg).resize(192, 192).png().toFile(out + 'icon-192.png');
await sharp(svg).resize(512, 512).png().toFile(out + 'icon-512.png');
await sharp(maskable).resize(512, 512).png().toFile(out + 'maskable-512.png');
await sharp(maskable).resize(180, 180).png().toFile(out + 'apple-touch-icon.png');
