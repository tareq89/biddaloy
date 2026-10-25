/**
 * [Epic 42] Capture toolkit for user-guide tours (`e2e/docs/tours/*.tour.ts`).
 *
 * - `guideLang()` / `imgDir()`: where a tour writes, per `GUIDE_LANG` (D27 paths).
 * - `prepare()`: the chosen language, the demo ribbon hidden, and the tap ripple
 *   (plus a pointer dot on mouse devices) so GIFs show what was pressed (D6).
 * - `shoot()` / `shot()`: a framed screenshot with numbered callouts; PNG <= 300 KB.
 * - `recordGif()`: runs one workflow in a recording context, then `gif.mjs` encodes it.
 * - `loginAs()`: signs in through a demo-school login card.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import type { Browser, BrowserContextOptions, Locator, Page } from '@playwright/test';

import bnDemo from '../../../ui/src/i18n/locales/bn/demo.json';
import enDemo from '../../../ui/src/i18n/locales/en/demo.json';
import { callouts as drawCallouts, clearCallouts, installPointer } from './overlays';

export type GuideLang = 'bn' | 'en';

export function guideLang(): GuideLang {
  return process.env.GUIDE_LANG === 'en' ? 'en' : 'bn';
}

/** `docs/user-guide/<lang>/<section>/img`, created on first use. */
export function imgDir(section: string): string {
  const dir = path.join('docs', 'user-guide', guideLang(), section, 'img');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A 3 px grey frame so a screenshot reads as a picture, not part of the page text. */
const MAX_PNG_KB = 300;
const FRAME = 'pad=iw+6:ih+6:3:3:color=#ced4da';

function frame(file: string): void {
  const tmp = `${file}.tmp.png`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', FRAME, tmp]);
  renameSync(tmp, file);
}

/** A 256-colour palette: a busy screen drops to well under the limit and still reads clearly. */
function shrink(file: string): void {
  const tmp = `${file}.tmp.png`;
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', file, '-vf',
    'split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=none', tmp,
  ]);
  renameSync(tmp, file);
}

/** Language, light mode, no demo ribbon, visible pointer. Call before the first `goto`. */
export async function prepare(page: Page, opts: { pointer?: boolean } = {}): Promise<void> {
  const lang = guideLang();
  // The tour's strings and folders come from GUIDE_LANG; a project of another
  // language would write its shots into the wrong folder.
  const projectLang = test.info().project.metadata.lang;
  if (projectLang && projectLang !== lang) {
    throw new Error(`project ${test.info().project.name} needs GUIDE_LANG=${projectLang}`);
  }
  await page.addInitScript((locale) => {
    window.localStorage.setItem('biddaloy:locale', locale);
  }, lang);
  if (opts.pointer) await installPointer(page, test.info().project.metadata.device === 'phone');
  // The ribbon says "demo site"; a school's own app never shows it.
  const labels = [bnDemo.ribbonLabel, enDemo.ribbonLabel].map((l) => JSON.stringify(l));
  const css =
    labels.map((l) => `[role="note"][aria-label=${l}]`).join(',') + '{display:none!important}';
  await page.addInitScript((rule) => {
    const add = () => {
      const style = document.createElement('style');
      style.textContent = rule;
      document.head.appendChild(style);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, css);
}

export interface Callout {
  target: Locator;
  /** Shown only in the page's numbered list; the image carries the number. */
  note?: string;
}

/**
 * Screenshot of the viewport with a numbered badge and an outline on each
 * target, in order. Targets must be visible. The overlay is removed after.
 */
export async function shoot(
  page: Page,
  file: string,
  callouts: Callout[] = [],
  opts: {
    keepToasts?: boolean;
    region?: { x: number; y: number; width: number; height: number };
  } = {},
): Promise<void> {
  // Wait for data: no loading skeleton left on the page (the demo API is slower than prod).
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector('main .animate-pulse, main [aria-busy="true"]'), undefined, {
      timeout: 30_000,
    })
    .catch(() => undefined);
  // A leftover "saved" toast would cover the part the shot is about.
  if (!opts.keepToasts) {
    await page.evaluate(() =>
      document
        .querySelectorAll<HTMLElement>('[data-sonner-toaster]')
        .forEach((n) => (n.style.display = 'none')),
    );
  }
  await drawCallouts(
    page,
    callouts.map((c) => c.target),
    file,
  );
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  // Let toasts and focus rings settle so the shot matches what a reader sees.
  await page.waitForTimeout(250);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide', clip: opts.region });
  frame(file);
  if (statSync(file).size / 1024 > MAX_PNG_KB) shrink(file);
  const kb = statSync(file).size / 1024;
  if (kb > MAX_PNG_KB)
    throw new Error(`${file} is ${kb.toFixed(0)} KB; the limit is ${MAX_PNG_KB} KB`);
  await clearCallouts(page);
  await page.evaluate(() =>
    document
      .querySelectorAll<HTMLElement>('[data-sonner-toaster]')
      .forEach((n) => (n.style.display = '')),
  );
}

/**
 * `shoot` by feature name: writes `<section>/img/<feature>-<nn>.png`, the section
 * coming from the generated `features.json` (an unknown feature is an error).
 */
export async function shot(
  page: Page,
  feature: string,
  nn: string,
  callouts: Callout[] = [],
  opts: Parameters<typeof shoot>[3] = {},
): Promise<void> {
  const registry = JSON.parse(
    readFileSync(path.join('docs', 'user-guide', '_generated', 'features.json'), 'utf8'),
  ) as { id: string; path: string }[];
  // `path` is `<section>/<page>`, relative to the language folder
  const section = registry.find((f) => f.id === feature)?.path.split('/')[0];
  if (!section) throw new Error(`feature "${feature}" is not in features.json`);
  await shoot(page, path.join(imgDir(section), `${feature}-${nn}.png`), callouts, opts);
}

/** A short pause so a GIF viewer can follow each step. */
export const beat = (page: Page, ms = 700) => page.waitForTimeout(ms);

/**
 * Runs `workflow` in a fresh recording context (same sign-in as `storageState`)
 * and writes `<file>.gif`. The first `trimStartSec` seconds (page load) are cut.
 */
export async function recordGif(
  browser: Browser,
  contextOptions: BrowserContextOptions,
  file: string,
  workflow: (page: Page) => Promise<void>,
  opts: { trimStartSec?: number; width?: number } = {},
): Promise<void> {
  const viewport = contextOptions.viewport ?? { width: 1440, height: 900 };
  const videoDir = path.join('test-results', 'guide', 'video', path.basename(file, '.gif'));
  rmSync(videoDir, { recursive: true, force: true });
  const context = await browser.newContext({
    ...contextOptions,
    recordVideo: { dir: videoDir, size: viewport },
  });
  const page = await context.newPage();
  await prepare(page, { pointer: true });
  await workflow(page);
  await beat(page, 1200);
  const video = page.video();
  await context.close();
  const webm = await video!.path();
  execFileSync('node', [
    'scripts/user-guide/gif.mjs',
    webm,
    file,
    '--start',
    String(opts.trimStartSec ?? 0),
    '--width',
    String(opts.width ?? 960),
  ]);
}

/** Sign in through a demo-school login card (`/login?role=<card>`), picking the school if asked. */
export async function loginAs(page: Page, card: string): Promise<void> {
  // /auth/login and /auth/refresh allow 5 a minute per IP; a tour that signs in often must pace itself.
  await page.waitForTimeout(13_000);
  await page.goto(`/login?role=${card}`);
  await page.waitForURL(/\/(dashboard|portal|select-school)/);
  if (page.url().includes('/select-school')) {
    await page.getByRole('button', { name: /Continue|চালিয়ে যান/ }).click();
    await page.waitForURL(/\/(dashboard|portal)/);
  }
  await expect(page).toHaveURL(/\/(dashboard|portal)/);
}
