/**
 * [Epic 42] Data-driven media for list-style guide pages. `shot-plan.json` (made by
 * `scripts/user-guide/gen-shot-plan.mjs`) lists, per page, one entry per pending image:
 * a page shot, or a dialog shot (first primary button pressed). One sign-in per
 * (role, device); every shot is isolated, so one failure does not stop the rest.
 *
 *   GUIDE_LANG=en GUIDE_SECTION=people npx playwright test -c playwright.docs.config.ts \
 *     --project=en-desktop --project=en-phone pages
 */
import { copyFileSync } from 'node:fs';

import { test, type Page } from '@playwright/test';

import plan from './shot-plan.json';
import { guideLang, imgDir, loginAs, prepare, shoot } from '../helpers/capture';

const DAY = process.env.GUIDE_DAY ?? '2026-10-22';
const section = process.env.GUIDE_SECTION ?? '';
const lang = guideLang();

interface Entry {
  idx: number;
  kind: string;
  login: string;
  phone: boolean;
  route: string;
}

const groups = new Map<string, { page: string; e: Entry }[]>();
for (const [page, entries] of Object.entries(plan as Record<string, Entry[]>)) {
  if (!page.startsWith(`${section}/`)) continue;
  for (const e of entries) {
    if (e.kind === 'skip') continue;
    const key = `${e.login}|${e.phone ? 'phone' : 'desktop'}`;
    groups.set(key, [...(groups.get(key) ?? []), { page, e }]);
  }
}

const withDate = (route: string) =>
  route.startsWith('/attendance') ? `${route}${route.includes('?') ? '&' : '?'}date=${DAY}` : route;

/** In-app navigation: a full reload calls /auth/refresh, which allows 5 a minute per IP. */
async function visit(page: Page, route: string): Promise<void> {
  await page.evaluate((r) => {
    window.history.pushState({}, '', r);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, route);
}

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}

for (const [key, items] of groups) {
  const [login, device] = key.split('|');
  test(`${section}: ${login} ${device}`, async ({ page }, info) => {
    test.skip(info.project.metadata.device !== device);
    test.setTimeout(900_000);
    await page.waitForTimeout(15_000); // sign-in allows 5 a minute per IP
    await prepare(page);
    await loginAs(page, login);
    // ponytail: no fake clock; faking it signs the session out. Pages with a date
    // (attendance) get ?date=<anchor day>; others may show the real day.
    const done = new Map<string, string>();
    for (const { page: pg, e } of items) {
      const [sec, slug] = pg.split('/');
      const file = `${imgDir(sec)}/${slug}-${String(e.idx + 1).padStart(2, '0')}.png`;
      const sig = `${e.route}|${e.kind}`;
      try {
        const prior = done.get(sig);
        if (prior) {
          copyFileSync(prior, file);
          continue;
        }
        await visit(page, withDate(e.route));
        await settle(page);
        if (/\/(login|select-school)/.test(page.url())) throw new Error(`signed out at ${e.route} as ${login}: ${page.url()}`);
        if (e.kind === 'pick') {
          // pages that start empty until a class (and section or subject) is chosen
          for (let n = 0; n < 3; n++) {
            const box = page
              .locator('main [role="combobox"]:not([disabled])')
              .filter({ hasText: /^(Select|বাছুন|Choose|নির্বাচন)/ })
              .first();
            if (!(await box.isVisible().catch(() => false))) break;
            await box.click();
            await page.locator('[role="option"]').first().click({ timeout: 5000 });
            await page.waitForTimeout(1000);
          }
          if (e.route === '/academics/syllabus') {
            // the first subject may have no topics: try the others until the list has rows
            const subject = page.locator('main [role="combobox"]').nth(1);
            for (let k = 1; k < 8 && !((await page.locator('main li').count()) > 0); k++) {
              await subject.click();
              const opt = page.locator('[role="option"]').nth(k);
              if (!(await opt.isVisible().catch(() => false))) break;
              await opt.click();
              await page.waitForTimeout(1200);
            }
          }
          await settle(page);
        }
        if (e.kind === 'row') {
          await page.locator(`main a[href^="${e.route}/"]:not([href*="/new"])`).first().click({ timeout: 8000 });
          await settle(page);
        }
        if (e.kind === 'day1') {
          await page.locator('main').getByText(/^(24|২৪)$/).first().click({ timeout: 8000 });
          await page.waitForTimeout(1200);
        }
        if (e.kind === 'change2') {
          await page.locator('main button').filter({ hasText: /^(Change|পরিবর্তন করুন)$/ }).nth(1).click({ timeout: 8000 });
          await page.waitForTimeout(1200);
        }
        if (e.kind === 'bell') {
          await page.locator('button[aria-haspopup="dialog"][aria-label^="Notifications"], button[aria-haspopup="dialog"][aria-label^="বিজ্ঞপ্তি"]').first().click({ timeout: 8000 });
          await page.waitForTimeout(1200);
        }
        if (e.kind === 'dialog') {
          // the page's main action: the last button in the page header row (the primary one) (not the alert banner above it)
          await page
            .locator('xpath=//main//h1/../..//button[not(@role="tab") and not(@role="combobox")] | //main//h1/../..//a[@role="button"]')
            .last().click({ timeout: 8000 });
          await page.waitForTimeout(1200);
        }
        await shoot(page, file, []);
        done.set(sig, file);
        if (e.kind === 'dialog' || e.kind === 'bell') await page.keyboard.press('Escape');
      } catch (err) {
        console.log(`FAILED ${file}: ${String(err).split('\n')[0]}`);
      }
    }
  });
}
