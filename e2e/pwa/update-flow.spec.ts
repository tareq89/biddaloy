import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, guest, test } from '../fixtures/test';
import { t } from '../i18n';

import { waitForSwControl } from './helpers';

/**
 * [8.12.6] AC 4 — the update flow, end to end, in a real browser against
 * a real second service worker.
 *
 * ```text
 *  tab A  ──▶ registration.update() ──▶ new sw.js installs, waits
 *              onNeedRefresh  ──▶ toast "a new version is available"
 *              click Reload   ──▶ SKIP_WAITING ──▶ activate ──▶ clientsClaim()
 *              onNeedReload (accepted)   ──▶ this tab reloads
 *  tab B      onNeedReload (not accepted) ──▶ toast "updated in another tab"
 *              click Reload   ──▶ tab B reloads when *its* user is ready
 * ```
 *
 * The "new version" is produced by appending a comment to the built
 * `dist/sw.js`. That is genuinely what a deploy looks like to the
 * browser: `sw.js` is byte-compared against the copy that installed it,
 * and any difference makes it a new worker. `vite preview` reads the file
 * from disk per request, so no rebuild or restart is needed — and the
 * file is restored in `finally`, because every other spec in this suite
 * is served out of the same `dist/`.
 *
 * The hourly `registration.update()` poll (`pwa/register.ts`) is far too
 * slow for a test, so the spec calls `update()` itself — the same call
 * the poll makes.
 *
 * This is the flakiest spec in the suite by nature (two tabs, a worker
 * lifecycle and two reloads), so every wait here is explicit rather than
 * implied by an assertion's auto-retry.
 */
const SW_DIST_PATH = resolve(__dirname, '../../client-admin/dist/sw.js');
const UPDATE_PROBE =
  '\n// [8.12.6] e2e update probe — appended and removed by update-flow.spec.ts\n';

test.describe('service worker update flow', () => {
  // Signed out on purpose: `/login` is a fully rendered route with no API
  // dependency, so the flow being asserted is the worker lifecycle and
  // the toast, not a session surviving two reloads.
  test.use(guest);

  test('one tab accepts the update, the other is asked rather than reloaded', async ({
    page,
    context,
  }) => {
    const original = readFileSync(SW_DIST_PATH, 'utf8');

    try {
      await page.goto('/login');
      await waitForSwControl(page);

      const tabB = await context.newPage();
      await tabB.goto('/login');
      await waitForSwControl(tabB);

      // Deploy.
      appendFileSync(SW_DIST_PATH, UPDATE_PROBE);

      // A marker that a reload will destroy — the only reliable way to
      // tell "this tab reloaded" apart from "this tab never changed".
      await page.evaluate(() => {
        (window as unknown as { __beforeUpdate?: boolean }).__beforeUpdate = true;
      });
      await tabB.evaluate(() => {
        (window as unknown as { __beforeUpdate?: boolean }).__beforeUpdate = true;
      });

      await test.step('tab A is offered the update', async () => {
        await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          await registration?.update();
        });
        await expect(page.getByText(t('common.update.available'))).toBeVisible({ timeout: 30_000 });
      });

      await test.step('accepting it reloads tab A onto the new worker', async () => {
        await page.getByRole('button', { name: t('common.update.reload') }).click();
        await expect
          .poll(
            () =>
              page.evaluate(
                () => (window as unknown as { __beforeUpdate?: boolean }).__beforeUpdate ?? false,
              ),
            { message: 'tab A should have reloaded itself', timeout: 30_000 },
          )
          .toBe(false);
        await waitForSwControl(page);
        // The prompt is gone with the old document, not left on screen
        // over the new version.
        await expect(page.getByText(t('common.update.available'))).toHaveCount(0);
      });

      await test.step('tab B is told, and left alone until its user is ready', async () => {
        await expect(tabB.getByText(t('common.update.activatedElsewhere'))).toBeVisible({
          timeout: 30_000,
        });
        // The whole point of overriding the plugin's default: a tab whose
        // user never asked for anything must not be reloaded out from
        // under them.
        expect(
          await tabB.evaluate(
            () => (window as unknown as { __beforeUpdate?: boolean }).__beforeUpdate ?? false,
          ),
        ).toBe(true);

        await tabB.getByRole('button', { name: t('common.update.reload') }).click();
        await expect
          .poll(
            () =>
              tabB.evaluate(
                () => (window as unknown as { __beforeUpdate?: boolean }).__beforeUpdate ?? false,
              ),
            { message: 'tab B should reload once its own user accepts', timeout: 30_000 },
          )
          .toBe(false);
      });

      await test.step('both tabs end up on the same, new worker', async () => {
        const [a, b] = await Promise.all([waitForSwControl(page), waitForSwControl(tabB)]);
        expect(a).toBe(b);
        const active = await page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return {
            hasWaiting: !!registration?.waiting,
            state: registration?.active?.state ?? null,
          };
        });
        expect(active.state).toBe('activated');
        // Nothing left waiting: the update was actually taken, not just
        // announced.
        expect(active.hasWaiting).toBe(false);
      });
    } finally {
      // Restored unconditionally — every other spec is served from this
      // same `dist/`, and a stray probe comment would leave them testing
      // a worker this spec invented.
      writeFileSync(SW_DIST_PATH, original);
    }
  });
});
