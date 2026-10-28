/**
 * [Epic 42 / W8] Small helpers for the finance, exams and administration tours.
 *
 * - `asRole()`: a fresh browser context signed in as a demo card (a full page
 *   reload drops the demo session, so tours move between pages with `go()`).
 * - `go()`: client-side navigation to a route (no reload).
 * - `tr()`: one string from the app's own i18n files, in the tour's language.
 * - `step()`: runs one shot; a failure is logged and the tour moves on.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Browser, Page, TestInfo } from '@playwright/test';

import { guideLang, loginAs, prepare, shoot } from './capture';
import { clearCallouts } from './overlays';

export async function asRole(browser: Browser, info: TestInfo, card: string): Promise<Page> {
  const context = await browser.newContext({
    ...info.project.use,
    baseURL: process.env.GUIDE_BASE_URL ?? 'http://localhost:5174',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await prepare(page);
  await loginAs(page, card);
  current = page;
  return page;
}

export async function go(page: Page, url: string): Promise<void> {
  await page.evaluate((u) => {
    window.history.pushState({}, '', u);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(600);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const cache = new Map<string, unknown>();

/** `tr('payments', 'list.title')`: the app's own words in the tour's language. */
export function tr(ns: string, key: string): string {
  const lang = guideLang();
  const file = path.join('ui', 'src', 'i18n', 'locales', lang, `${ns}.json`);
  if (!cache.has(file)) cache.set(file, JSON.parse(readFileSync(file, 'utf8')));
  let node = cache.get(file) as Record<string, unknown> | string | undefined;
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part] as never;
  if (typeof node !== 'string') throw new Error(`missing i18n ${lang}/${ns}:${key}`);
  return node;
}

export const re = (s: string) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{\\\{\w+\\\}\\\}/g, '.*'));

let current: Page | undefined;

export async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`SHOT_OK ${name}`);
  } catch (e) {
    console.log(`SHOT_FAIL ${name}: ${String((e as Error).message).split('\n')[0]}`);
    await current?.screenshot({ path: `/private/tmp/claude-501/shots-c/fail-${name}.png` }).catch(() => undefined);
    await clearCallouts(current!).catch(() => undefined);
    await current?.keyboard.press('Escape').catch(() => undefined);
  }
}

/** `shoot` that squeezes a too-heavy PNG (palette of 96 colours) instead of failing. */
export async function snap(
  page: Page,
  file: string,
  callouts: Parameters<typeof shoot>[2] = [],
  opts: Parameters<typeof shoot>[3] = {},
): Promise<void> {
  try {
    await shoot(page, file, callouts, opts);
  } catch (e) {
    if (!/the limit is/.test(String((e as Error).message))) throw e;
    await clearCallouts(page);
    const tmp = `${file}.q.png`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-vf', 'palettegen=max_colors=96', `${tmp}.pal.png`]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-i', `${tmp}.pal.png`, '-lavfi', 'paletteuse=dither=none', tmp]);
    renameSync(tmp, file);
    rmSync(`${tmp}.pal.png`, { force: true });
    const kb = statSync(file).size / 1024;
    if (kb > 300) throw new Error(`${file} is still ${kb.toFixed(0)} KB after squeezing`);
  }
}
