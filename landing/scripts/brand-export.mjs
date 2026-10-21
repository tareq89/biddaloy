// Run from the repo root: node landing/scripts/brand-export.mjs
// Renders the committed brand PNGs from the SVGs. `sharp` is a build-time tool only;
// the outputs are committed so the site build needs no sharp. Re-run after editing an SVG.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'src/assets/brand');
const pub = join(root, 'public');
mkdirSync(join(pub, 'icons'), { recursive: true });
mkdirSync(join(root, 'src/assets/og'), { recursive: true });

const png = (img, out) => img.png({ compressionLevel: 9, palette: true }).toFile(out);
const svg = (name) => readFileSync(join(brand, name));

// Tab icons (favicon.svg, favicon-32) use the simplified house: at 16-32 px the four
// module blocks blur together, so the small file draws them as one block.
copyFileSync(join(brand, 'monogram-small.svg'), join(pub, 'favicon.svg'));
const mono = (name, size, out) =>
  png(sharp(svg(name), { density: 384 }).resize(size, size), join(pub, out));
// 192 is a downscale of the emitted 512 file, not its own render: client-admin's icons test compares
// the two pixel for pixel, and separate renders (or a quantised 192) differ on glyph edges.
await mono('monogram.svg', 512, 'icons/pwa-512.png');
await sharp(join(pub, 'icons/pwa-512.png'))
  .resize(192, 192)
  .png({ compressionLevel: 9 })
  .toFile(join(pub, 'icons/pwa-192.png'));
await Promise.all([
  mono('monogram-small.svg', 32, 'favicon-32.png'),
  mono('monogram-maskable.svg', 180, 'apple-touch-icon.png'), // iOS rounds the corners itself
  mono('monogram-maskable.svg', 512, 'icons/pwa-maskable-512.png'),
]);

// OG 1200x630: wordmark + "by Biddaloy" + one line per language.
// ponytail: text uses the system fallback font (Hind Siliguri is not wired up here);
// regenerate once the site fonts exist (wave 3).
const lines = { en: 'School management, made simple.', bn: 'স্কুল পরিচালনা, এবার সহজ।' };
const font = "Helvetica, Arial, 'Bangla Sangam MN', 'Noto Sans Bengali', sans-serif";
const wm = await sharp(svg('wordmark.svg'), { density: 192 })
  .resize({ width: 880 })
  .png()
  .toBuffer();
const { height: wmH } = await sharp(wm).metadata();
for (const [lang, line] of Object.entries(lines)) {
  const text = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <text x="160" y="335" font-size="34" fill="#6f6e69" font-family="${font}">by Biddaloy</text>
    <text x="160" y="410" font-size="44" fill="#17305E" font-family="${font}">${line}</text>
    <rect x="0" y="618" width="1200" height="12" fill="#17305E"/></svg>`;
  await png(
    sharp({ create: { width: 1200, height: 630, channels: 3, background: '#ffffff' } }).composite([
      { input: wm, left: 160, top: 250 - wmH },
      { input: Buffer.from(text) },
    ]),
    join(root, `src/assets/og/og-${lang}.png`),
  );
}

// client-admin ships the same artwork: favicon, PWA icons and the English OG card.
const admin = join(root, '../client-admin/public');
copyFileSync(join(pub, 'favicon.svg'), join(admin, 'favicon.svg'));
copyFileSync(join(pub, 'icons/pwa-512.png'), join(admin, 'icons/pwa-512.png'));
copyFileSync(join(pub, 'icons/pwa-192.png'), join(admin, 'icons/pwa-192.png'));
copyFileSync(join(pub, 'icons/pwa-maskable-512.png'), join(admin, 'icons/maskable-512.png'));
copyFileSync(join(root, 'src/assets/og/og-en.png'), join(admin, 'og.png'));
