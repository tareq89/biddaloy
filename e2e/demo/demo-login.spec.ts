import { expect, test, type Page } from '@playwright/test';

/**
 * [58.2.08] Demo login, end to end. Runs only in the opt-in `demo` project (see
 * `docs/architecture/22-demo-seed.md`): it needs a server started with `DEMO_MODE=true` on a
 * database filled by `yarn workspace @biddaloy/server seed:demo`, not the dev-seed stack.
 *
 * English strings are matched from `ui/src/i18n/locales/en/demo.json` on purpose: the page is
 * forced to `en` below, and the spec checks behaviour, not translations.
 */
/** One card per entry of DEMO_CARDS (server/src/modules/demo/demo-accounts.ts). */
const CARD_COUNT = 9;

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));
});

const ribbon = (page: Page) => page.getByRole('note', { name: /Demo site/ });
const accountButton = (page: Page) => page.getByRole('button', { name: /^Account menu/ });

async function signInAs(page: Page, cardName: RegExp) {
  await page.goto('/login');
  await page.getByRole('button', { name: cardName }).click();
  await continueFromPicker(page);
}

/** Admin and the guardian hold several memberships, so they pass the school picker first. */
async function continueFromPicker(page: Page) {
  // Wait for where sign-in settles, not just "off /login": it can pass through `/` first.
  await expect(page).toHaveURL(/\/(select-school|dashboard|portal)/);
  if (/\/select-school/.test(page.url())) {
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page).not.toHaveURL(/\/(login|select-school)/);
}

// [87.2.04] The demo-reset container sets MESSAGE_SINK and the public inbox URL (#3204). When the
// server hands the page that URL, the notice bar must link to it; a local run without a sink skips.
test('/login links to the test inbox when the server has one', async ({ page }) => {
  await page.goto('/login');
  const inboxUrl = await page.evaluate(
    () =>
      (window as { __BIDDALOY_CONFIG__?: { messageSinkUrl?: string } }).__BIDDALOY_CONFIG__
        ?.messageSinkUrl ?? '',
  );
  test.skip(!inboxUrl, 'no messageSinkUrl in runtime config: this server has no test inbox');
  await expect(page.locator(`a[href="${inboxUrl}"]`)).toBeVisible();
});

test('/login shows one card per demo login and a single page title', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Enter the demo school');
  await expect(page.getByRole('button', { name: /Try:/ })).toHaveCount(CARD_COUNT);
});

test('keyboard only: the first card has focus, Enter lands on the dashboard', async ({ page }) => {
  await page.goto('/login');
  const first = page.getByRole('button', { name: /Admin/ });
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await continueFromPicker(page);
  await expect(page.getByRole('main')).toBeVisible();
});

test('the ribbon is visible and never covers the account button', async ({ page }) => {
  await signInAs(page, /Admin/);
  await expect(ribbon(page)).toBeVisible();
  // Boxes, not elementFromPoint: the ribbon is pointer-events-none, so a hit test sees through
  // it. Its box is the square holding the triangle, the area `reserveCorner` keeps free.
  const clear = async () => {
    const r = (await ribbon(page).boundingBox())!;
    const b = (await accountButton(page).boundingBox())!;
    return b.x + b.width <= r.x || b.y >= r.y + r.height;
  };
  expect(await clear()).toBe(true);

  // Mobile (390 px): the corner is reserved on the phone header row too.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(accountButton(page)).toBeVisible();
  expect(await clear()).toBe(true);
});

test('"View as another role" goes back to /login', async ({ page }) => {
  await signInAs(page, /Principal/);
  await accountButton(page).click();
  await page.getByRole('menuitem', { name: 'View as another role' }).click();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: /Try:/ })).toHaveCount(CARD_COUNT);
});

test('the guardian can switch branch and see the other child', async ({ page }) => {
  await signInAs(page, /Guardian/);
  // The Secondary branch shows the Class 9-B child.
  await expect(page.getByText(/Class 9/).first()).toBeVisible();

  await accountButton(page).click();
  await page.getByRole('menuitem', { name: /Switch school or role/ }).click();
  await page.getByRole('menuitem', { name: /Primary Branch/ }).click();
  await page.getByRole('button', { name: 'Switch school' }).click();
  // The Primary branch shows the Class 3 child.
  await expect(page.getByText(/Class 3/).first()).toBeVisible({ timeout: 15_000 });
});

test('/login?role=guardian signs in as the guardian and drops the param', async ({ page }) => {
  await page.goto('/login?role=guardian');
  await continueFromPicker(page);
  await expect(page).toHaveURL(/\/portal/);
  expect(page.url()).not.toContain('role=');
});
