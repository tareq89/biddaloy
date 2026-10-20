import { adminApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import { REGISTRY } from './double-submit.registry';

/**
 * [2656] Standing guard behind #2594, #2622 and #2631: every create/send dialog sends exactly
 * one write request when its submit button is double-clicked. The response is HELD until after
 * the double-click, so a second request would reach the route before `gate` opens and the
 * count below is race-free. Add new dialogs to `double-submit.registry.ts`.
 */
test.describe('double-submit: one request per create/send dialog', () => {
  test.use(loggedIn('admin'));
  // A service worker hides requests from `page.route`.
  test.use({ serviceWorkers: 'block' });

  for (const entry of REGISTRY) {
    test(entry.name, async ({ page, request }, testInfo) => {
      const suffix = `${Date.now()}-${testInfo.repeatEachIndex}-${testInfo.workerIndex}`;
      const prepared = await entry.prepare?.(request, await adminApiSession(request), suffix);
      let posts = 0;
      let open!: () => void;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      await page.route(entry.postUrl, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        posts += 1;
        await gate;
        return route.fallback();
      });

      await page.goto(prepared?.route ?? entry.route);
      await entry.open(page, suffix);
      await entry.fill(page, suffix);
      await page.getByRole('button', { name: t(entry.submitKey) }).dblclick();
      open();

      try {
        await entry.done(page, suffix);
      } finally {
        // Soft, so a double send is reported even when its second answer (a 409) also kept the
        // dialog open and failed `done`.
        expect.soft(posts, `${entry.name} sent ${posts} write requests`).toBe(1);
      }
    });
  }
});
