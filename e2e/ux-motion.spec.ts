import { expect, guest, loggedIn } from './fixtures/test';
import { test } from './fixtures/settings-lock';
import { makeT } from './i18n';

/**
 * [3329.4.03] The motion kit runs, and stops under `prefers-reduced-motion`.
 *
 * Class, attribute and computed-style checks only: no fixed sleeps, no
 * screenshots, no timing windows (the reduced-motion flake note in #1717).
 * Each subject is measured once WITHOUT the preference (so the assertion
 * cannot pass on something that never animated) and once WITH it.
 *
 * Subjects:
 *  - Button press: the login submit button carries the `scale` transition
 *    from `button.tsx`.
 *  - SuccessTick: the verify-email success page, with the verify call
 *    answered by a stub so no real token is needed.
 *  - RollingNumber: the digit spans a dashboard StatTile renders; under
 *    reduce the component renders plain text instead.
 *
 * PullToRefresh is not covered: no page mounts it yet (it is only exported
 * from `@biddaloy/ui/components`), so there is nothing to drive. Its
 * behaviour stays proven by `pull-to-refresh.test.tsx`.
 */

/** Longest computed duration in ms (`"0.28s, 0.1s"` -> 280). */
function longestMs(computed: string): number {
  return Math.max(
    ...computed.split(',').map((part) => {
      const v = part.trim();
      const n = Number.parseFloat(v);
      if (!Number.isFinite(n)) return 0;
      return v.endsWith('ms') ? n : n * 1000;
    }),
  );
}

const MOTION = ['no-preference', 'reduce'] as const;

test.describe('button press', () => {
  test.use(guest);

  for (const motion of MOTION) {
    test(`submit button keeps its scale transition (${motion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto('/login');
      const button = page.getByRole('button', { name: makeT()('auth.submit.action') });
      await expect(button).toBeVisible();

      // The press styling is part of the markup in both modes; reduce only
      // zeroes its duration, it never removes the class.
      await expect(button).toHaveClass(/active:not-disabled/);
      await expect(button).toHaveCSS('transition-property', /scale/);
      const ms = longestMs(await button.evaluate((el) => getComputedStyle(el).transitionDuration));
      if (motion === 'reduce') expect(ms).toBeLessThan(1);
      else expect(ms).toBeGreaterThanOrEqual(100);
    });
  }
});

test.describe('success tick', () => {
  test.use(guest);

  for (const motion of MOTION) {
    test(`verify-email success shows the tick (${motion})`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.route('**/auth/verify-email', (route) =>
        route.fulfill({ json: { status: 'valid' } }),
      );
      const verified = page.waitForResponse(
        (r) => r.url().includes('/auth/verify-email') && r.request().method() === 'POST',
      );
      await page.goto('/verify-email?token=e2e-motion');
      await verified;

      const tick = page.locator('[role="status"]:has(svg circle)');
      await expect(tick).toBeVisible();
      // Same end state in both modes: the screen-reader label is present.
      await expect(tick.locator('.sr-only')).not.toBeEmpty();

      const circle = tick.locator('circle');
      const ms = longestMs(await circle.evaluate((el) => getComputedStyle(el).transitionDuration));
      if (motion === 'reduce') {
        expect(ms).toBeLessThan(1);
        // Reduced motion must still land the finished tick.
        await expect(circle).toHaveCSS('stroke-dashoffset', '0px');
      } else {
        // 0.6 x --motion-duration-confirm
        expect(ms).toBeGreaterThanOrEqual(100);
      }
    });
  }
});

test.describe('rolling number', () => {
  test.use(loggedIn('admin'));

  test('digits roll in normally', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/dashboard');
    const digit = page.locator('[data-rolling-digit]').first();
    await expect(digit).toBeAttached();
    // Settles visible, and the glyph is carried by data-char.
    await expect(digit).toHaveCSS('opacity', '1');
    await expect(digit).toHaveAttribute('data-char', /^[0-9০-৯]$/);
  });

  test('reduced motion renders plain numbers, no digit spans', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dashboard');
    await expect(page.getByRole('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-rolling-digit]')).toHaveCount(0);
  });
});
