/**
 * Regenerates landing/src/assets/shots/** from a running demo (50.9).
 *   SHOOT_BASE_URL=http://localhost:3000 SHOOT_PASSWORD=... yarn workspace @biddaloy/landing shoot
 * SHOOT_PASSWORD is `password` from GET <base>/api/v1/demo/roles; it is only checked here, the app
 * signs in through /login?role=<key> (50.8). Demo names are synthetic, so nothing is masked.
 */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGS, THEMES, VIEWPORTS, shotFile, shotName, shots } from './shots.manifest.ts';

const base = process.env.SHOOT_BASE_URL;
const password = process.env.SHOOT_PASSWORD;
if (!base || !password) throw new Error('Set SHOOT_BASE_URL and SHOOT_PASSWORD');

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../src/assets/shots');
const placeholdersPath = join(outDir, 'shots.placeholders.json');

const roles = (await (await fetch(`${base}/api/v1/demo/roles`)).json()) as {
  enabled: boolean;
  password: string;
  cards: { key: string }[];
};
if (!roles.enabled || roles.password !== password) {
  throw new Error('Not a demo host, or wrong SHOOT_PASSWORD');
}
const keys = new Set(roles.cards.map((c) => c.key));

// ponytail: sharp ships with astro; if it ever stops resolving, drop the blur data.
const { default: sharp } = await import('sharp');
const placeholders: Record<string, string> = JSON.parse(
  await readFile(placeholdersPath, 'utf8').catch(() => '{}'),
);

const browser = await chromium.launch();
try {
  for (const s of shots) {
    if (!keys.has(s.role)) throw new Error(`Unknown demo role ${s.role}`);
    for (const lang of LANGS) {
      for (const theme of THEMES) {
        const context = await browser.newContext({ viewport: VIEWPORTS[s.viewport] });
        await context.addInitScript(
          ([l, t]) => {
            localStorage.setItem('biddaloy:locale', l);
            localStorage.setItem('biddaloy:theme', t);
          },
          [lang, theme],
        );
        const page = await context.newPage();
        await page.goto(`${base}/login?role=${s.role}`);
        // Several memberships stop at the school picker first.
        await page.waitForURL(/\/(select-school|dashboard|portal)/);
        if (/select-school/.test(page.url())) {
          await page.getByRole('button', { name: /Continue|চালিয়ে/ }).click();
        }
        await page.goto(`${base}${s.url}`);
        const el = page.locator(s.selector).first();
        await el.waitFor();
        await page.waitForLoadState('networkidle');
        const file = shotFile(s, lang, theme);
        const png = await el.screenshot({ animations: 'disabled' });
        await mkdir(dirname(join(outDir, file)), { recursive: true });
        await writeFile(join(outDir, file), png);
        const tiny = await sharp(png).resize(16).blur().jpeg({ quality: 40 }).toBuffer();
        placeholders[`${shotName(s)}.${lang}.${theme}`] =
          `data:image/jpeg;base64,${tiny.toString('base64')}`;
        console.log('wrote', file);
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  await writeFile(placeholdersPath, JSON.stringify(placeholders, null, 2) + '\n');
}
