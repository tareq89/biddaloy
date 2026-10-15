import { expect, test } from '@playwright/test';

import { signedOutAt } from './sweep-session';

/**
 * [58.4.02] Proof that the nightly sweep fails when a visit bounces to a signed-out page. Runs in
 * the `demo-nightly` project next to the sweep; it needs no server (the page is fulfilled in place).
 */
test('a visit that bounces to /login counts as signed out', async ({ page }) => {
  // What the SPA does when the refresh cookie was dropped: the guard sends the visitor to /login.
  await page.route('http://demo.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<main>Sign in</main><script>history.replaceState(null, "", "/login?redirect=%2Fstudents")</script>',
    }),
  );
  await page.goto('http://demo.test/students');
  await expect(page).toHaveURL(/\/login\?redirect=/);
  expect(signedOutAt(page.url())).toBe('/login');
});

test('signed-out pages are caught, signed-in pages are not', () => {
  expect(signedOutAt('http://demo-reset:3999/login')).toBe('/login');
  expect(signedOutAt('http://demo-reset:3999/select-school?redirect=%2F')).toBe('/select-school');
  expect(signedOutAt('http://demo-reset:3999/forgot-password')).toBe('/forgot-password');
  expect(signedOutAt('http://demo-reset:3999/students')).toBeNull();
  expect(signedOutAt('http://demo-reset:3999/students/login-history')).toBeNull();
  expect(signedOutAt('http://demo-reset:3999/admission/bmsc-high')).toBeNull();
});
