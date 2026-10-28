import type { Page } from '@playwright/test';

import { expect, guest, loggedIn, test } from '../fixtures/test';

/**
 * [#3214] The live CSP says `style-src 'self'`: the browser blocks every
 * `<style>` tag or `style="..."` attribute made at runtime. `vite preview`
 * sends no CSP, so no other spec can see such a block. This one adds the
 * header to every page load and fails on any `style-src` violation.
 *
 * ```text
 *   vite preview (built app) ──▶ page.route adds  style-src 'self'
 *                                      │
 *   page ──securitypolicyviolation──▶ violations[]  ──▶ expect []
 * ```
 *
 * Example failure (sonner before the fix):
 * `style-src-elem: [data-sonner-toaster][dir=ltr],html[dir=`
 *
 * Only `style-src` matters here: zod probes `Function('')` once (a caught
 * `script-src` report) and that is not this bug. The value must match
 * `styleSrc` in `server/src/security-headers.ts`.
 *
 * Here, unlike the rest of `e2e/pwa/`, the service worker is blocked: a page
 * it serves never passes through `page.route`, so it would load with no CSP
 * and pass without testing anything. No service-worker behaviour is under
 * test here.
 */
const CSP = "style-src 'self'";

test.use({ serviceWorkers: 'block' });

async function enforceCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction('__cspViolation', (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      if (e.effectiveDirective.startsWith('style-src')) {
        (window as unknown as { __cspViolation: (v: string) => void }).__cspViolation(
          `${e.effectiveDirective}: ${e.sample} (${e.sourceFile}:${e.lineNumber})`,
        );
      }
    });
  });
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') return route.continue();
    const response = await route.fetch();
    await route.fulfill({
      response,
      // 'report-sample' puts the first 40 characters of the blocked CSS in the failure message.
      headers: { ...response.headers(), 'content-security-policy': `${CSP} 'report-sample'` },
    });
  });
  return violations;
}

test.describe('guest pages', () => {
  test.use(guest);

  test('load with no inline-style violation, and toasts keep their stylesheet', async ({
    page,
  }) => {
    const violations = await enforceCsp(page);
    for (const path of ['/login', '/register', '/forgot-password']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    expect(violations).toEqual([]);
    // sonner renders its toast list as `<ol data-sonner-toaster>`; with its CSS
    // missing the list is `static` and toasts land at the bottom of the page.
    const toasterPosition = await page.evaluate(() => {
      const ol = document.createElement('ol');
      ol.setAttribute('data-sonner-toaster', '');
      document.body.appendChild(ol);
      return getComputedStyle(ol).position;
    });
    expect(toasterPosition).toBe('fixed');
  });
});

test.describe('signed-in page with a modal open', () => {
  test.use(loggedIn('admin'));

  test('the command palette locks scroll with no inline-style violation', async ({ page }) => {
    const violations = await enforceCsp(page);
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).toBeVisible();
    // Radix marks <body> while a modal is open; the lock rule lives in globals.css.
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    expect(violations).toEqual([]);
  });
});
