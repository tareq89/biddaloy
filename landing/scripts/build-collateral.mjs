/**
 * Offline sales collateral, built from the same content files as the home page (D44).
 *   node scripts/build-collateral.mjs   (runs after `astro build`; also fine on its own)
 * Out: dist/sm-ek-pata.pdf (one A4 page) and dist/sm-whatsapp.png (1080x1080).
 * Needs Node 24 (imports the .ts content files directly) and a Playwright Chromium.
 */
import { chromium } from '@playwright/test';
import QRCode from 'qrcode';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { value, setup } from '../src/content/value.ts';
import {
  PRICE_PER_SEAT_PAISA,
  FREE_UNTIL,
  formatMoney,
  formatNumber,
  total,
} from '../src/content/pricing.ts';
import { company } from '../src/content/legal.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const SITE = 'https://schoolmanagerp.com';
const MAX_BYTES = 300 * 1024;
const lang = 'bn';

const num = process.env.PUBLIC_WA_NUMBER;
const phone = num ? `+${num}` : company.phone;

const MONTHS = [
  'জানুয়ারি',
  'ফেব্রুয়ারি',
  'মার্চ',
  'এপ্রিল',
  'মে',
  'জুন',
  'জুলাই',
  'আগস্ট',
  'সেপ্টেম্বর',
  'অক্টোবর',
  'নভেম্বর',
  'ডিসেম্বর',
];
const [y, m, d] = FREE_UNTIL.split('-').map(Number);
const freeUntil = `${formatNumber(lang, d)} ${MONTHS[m - 1]} ${formatNumber(lang, y).replace(/,/g, '')}`;
const headline = `${freeUntil} পর্যন্ত ফ্রি`;
const price = `${formatMoney(lang, PRICE_PER_SEAT_PAISA)} / ছাত্র / মাস · ${formatNumber(lang, 500)} ছাত্রে ${formatMoney(lang, total(500, 1))}`;
const wordmark = 'SchoolManager ERP';
const siteText = SITE.replace('https://', '');

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const fonts = [400, 600, 700]
  .flatMap((w) =>
    ['bengali', 'latin'].map((s) => {
      const f = pathToFileURL(join(root, `public/fonts/hind-siliguri-${w}-${s}.woff2`)).href;
      const range =
        s === 'bengali' ? 'U+0980-09FE,U+200C-200D,U+20B9,U+0964-0965' : 'U+0000-00FF,U+2000-206F';
      return `@font-face{font-family:"Hind Siliguri";font-weight:${w};src:url(${f}) format("woff2");unicode-range:${range}}`;
    }),
  )
  .join('\n');

const fill = (html, vars) =>
  html.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`template var ${k} missing`);
    return vars[k];
  });

const pdfHtml = fill(await readFile(join(root, 'src/collateral/ek-pata.html'), 'utf8'), {
  FONTS: fonts,
  WORDMARK: wordmark,
  HEADLINE: headline,
  PRICE: esc(price),
  BEFORE_H: 'আগে',
  AFTER_H: 'এখন',
  ROWS: value.rows
    .map(
      (r) =>
        `<tr><td class="n">${esc(r.name[lang])}</td><td>${esc(r.before[lang])}</td><td>${esc(r.after[lang])}</td></tr>`,
    )
    .join(''),
  SETUP_TITLE: esc(setup.title[lang]),
  STEPS: setup.steps
    .map((s) => `<li><b>${esc(s.title[lang])}</b>: ${esc(s.text[lang])}</li>`)
    .join(''),
  PHONE: esc(phone),
  SITE: siteText,
  QR: await QRCode.toString(SITE, { type: 'svg', margin: 0 }),
});
// results, attendance, fees: the three jobs a committee asks about first
const waHtml = fill(await readFile(join(root, 'src/collateral/whatsapp.html'), 'utf8'), {
  FONTS: fonts,
  WORDMARK: wordmark,
  HEADLINE: headline,
  PRICE: esc(price),
  OUTCOMES: [0, 1, 3]
    .map((i) => value.rows[i])
    .map((r) => `<li><b>${esc(r.name[lang])}</b>${esc(r.after[lang])}</li>`)
    .join(''),
  PHONE: esc(phone),
  SITE: siteText,
});

await mkdir(dist, { recursive: true });
const tmp = await mkdtemp(join(tmpdir(), 'sm-collateral-'));
const browser = await chromium.launch().catch((e) => {
  if (/Executable doesn't exist/.test(String(e))) throw new Error('Chromium missing: run `yarn playwright install chromium`, then build again.');
  throw e;
});
try {
  const render = async (name, html, run) => {
    const f = join(tmp, name);
    await writeFile(f, html);
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    await page.goto(pathToFileURL(f).href);
    await page.evaluate('document.fonts.ready');
    await run(page);
    await page.close();
  };
  const pdfPath = join(dist, 'sm-ek-pata.pdf');
  const pngPath = join(dist, 'sm-whatsapp.png');
  await render('ek-pata.html', pdfHtml, (p) =>
    p.pdf({ path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true }),
  );
  await render('whatsapp.html', waHtml, (p) =>
    p.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: 1080, height: 1080 } }),
  );

  // Fail the build on a bad output. Page count: Chromium writes each page as an uncompressed `/Type /Page` dict.
  const pdf = await readFile(pdfPath, 'latin1');
  const pages = (pdf.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
  const size = (await stat(pdfPath)).size;
  if (pages !== 1) throw new Error(`sm-ek-pata.pdf has ${pages} pages, expected 1`);
  if (size > MAX_BYTES) throw new Error(`sm-ek-pata.pdf is ${size} bytes, max ${MAX_BYTES}`);
  console.log(`collateral ok: pdf ${pages} page ${size} B, png ${(await stat(pngPath)).size} B`);
} finally {
  await browser.close();
}
