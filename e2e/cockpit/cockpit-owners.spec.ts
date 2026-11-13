import type { Browser, Page } from '@playwright/test';

import {
  apiEnrol,
  apiSignIn,
  devOwner,
  expect,
  fillStable,
  freshTotp,
  fullNameOf,
  newOwner,
  resetOwners,
  setApprovals,
  expectAccessiblePage,
  tc,
  test,
  warmUp,
  type Owner,
} from './helpers';

/**
 * [98.4.99] The platform owners page end to end: Lock is disabled for yourself, lock and unlock
 * with a code, the approvals switch, and a gated action that waits for the other owner and runs
 * once after approval. The seeded dev owner plus one new owner (enrolled over the API) are the two
 * owners. Desktop and the 390 px `cockpit-phone` project.
 *
 * The "last active owner" disabled state is not driven here: the viewer is always an active owner,
 * so a second active owner is always on the page and the note can only show for a locked viewer
 * (covered by owners-tab.test.tsx and the server's LAST_OWNER spec).
 */
// A TOTP code works once per 30 s step, so a flow with several codes waits for steps.
test.describe.configure({ mode: 'serial', timeout: 180_000 });

let dev: Owner;
let other: Owner;
let devName = '';
let otherName = '';

/** A signed-in browser profile for `owner` (password, authenticator, device codes over the API). */
async function openAs(browser: Browser, owner: Owner, path: string): Promise<Page> {
  const { playwright } = await import('@playwright/test').then((m) => ({ playwright: m }));
  const { baseURL, viewport, hasTouch } = test.info().project.use;
  const api = await playwright.request.newContext({ baseURL: baseURL! });
  await apiSignIn(api, owner);
  const context = await browser.newContext({
    baseURL: baseURL!,
    viewport: viewport ?? null,
    hasTouch: hasTouch ?? false,
    storageState: await api.storageState(),
  });
  await api.dispose();
  const page = await context.newPage();
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  return page;
}

const card = (page: Page, name: string) => page.getByRole('group', { name });

/** The code prompt step-up opens for a gated action. */
async function enterCode(page: Page, owner: Owner): Promise<void> {
  const label = tc('approval', 'codeOnly.label');
  const dialog = page.getByRole('dialog').filter({ has: page.getByLabel(label) });
  await fillStable(dialog.getByLabel(label), await freshTotp(owner.secret!));
  await dialog.getByRole('button', { name: tc('approval', 'submit') }).click();
}

/** The "are you sure" dialog in front of the code prompt. */
async function confirmDialog(page: Page, label: string): Promise<void> {
  await page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog'))
    .getByRole('button', { name: label, exact: true })
    .click();
}

test.beforeAll(async ({ playwright, browser }) => {
  await warmUp(browser, ['/sign-in']);
  await resetOwners();
  dev = await devOwner();
  other = await newOwner('Second Owner');
  const api = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL!,
  });
  await apiEnrol(api, other);
  await api.dispose();
  devName = await fullNameOf(dev.email);
  otherName = await fullNameOf(other.email);
});

test.afterAll(async () => {
  await resetOwners();
});

test('Lock is disabled for yourself', async ({ browser }) => {
  const page = await openAs(browser, dev, '/platform-owners');
  const mine = card(page, devName);
  await expect(
    mine.getByRole('button', { name: tc('platformOwners', 'owners.lock'), exact: true }),
  ).toBeDisabled();
  await expect(mine.getByText(tc('platformOwners', 'owners.lockDisabledSelf'))).toBeVisible();
  // The other owner can be locked: the button is live.
  await expect(
    card(page, otherName).getByRole('button', {
      name: tc('platformOwners', 'owners.lock'),
      exact: true,
    }),
  ).toBeEnabled();
  await page.context().close();
});

test('the owners and security screens pass axe and do not scroll sideways', async ({ browser }) => {
  const page = await openAs(browser, dev, '/platform-owners');
  for (const tab of ['owners', 'approvals', 'history']) {
    await page.goto(`/platform-owners?tab=${tab}`);
    await expectAccessiblePage(page);
  }
  await page.goto('/owner-security');
  await expectAccessiblePage(page);
  await page.context().close();
});

test('lock and unlock with a code (approvals off)', async ({ browser }) => {
  await setApprovals(false);
  const page = await openAs(browser, dev, '/platform-owners');
  const lock = tc('platformOwners', 'owners.lock');
  const unlock = tc('platformOwners', 'owners.unlock');

  await card(page, otherName).getByRole('button', { name: lock, exact: true }).click();
  await confirmDialog(page, lock);
  await enterCode(page, dev);
  await expect(
    page.getByText(tc('platformOwners', 'owners.locked', { name: otherName })),
  ).toBeVisible();
  await expect(
    card(page, otherName).getByText(tc('platformOwners', 'owners.status.LOCKED')),
  ).toBeVisible();

  await card(page, otherName).getByRole('button', { name: unlock, exact: true }).click();
  await confirmDialog(page, unlock);
  await enterCode(page, dev);
  await expect(
    page.getByText(tc('platformOwners', 'owners.unlocked', { name: otherName })),
  ).toBeVisible();
  await expect(
    card(page, otherName).getByText(tc('platformOwners', 'owners.status.ACTIVE')),
  ).toBeVisible();
  await page.context().close();
});

test('the approvals switch turns on with a code', async ({ browser }) => {
  const page = await openAs(browser, dev, '/platform-owners?tab=approvals');
  const toggle = page.getByRole('switch', { name: tc('platformOwners', 'approvals.switch.label') });
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await confirmDialog(page, tc('platformOwners', 'approvals.switch.turnOnConfirm'));
  await enterCode(page, dev);
  await expect(page.getByText(tc('platformOwners', 'approvals.switch.turnedOn'))).toBeVisible();
  await expect(toggle).toBeChecked();
  await page.context().close();
});

test('a gated action waits for the other owner and runs once after approval', async ({
  browser,
}) => {
  // Turning approvals off is the gated action (lock and unlock need a code but never the other owner, D8).
  const key = (k: string) => tc('platformOwners', `approvals.switch.${k}`);
  const mine = await openAs(browser, dev, '/platform-owners?tab=approvals');
  const toggle = mine.getByRole('switch', { name: key('label') });
  await expect(toggle).toBeChecked();

  // 1. The first owner asks: nothing changes, the page says it is waiting.
  await toggle.click();
  await confirmDialog(mine, key('turnOffConfirm'));
  await enterCode(mine, dev);
  await expect(mine.getByText(key('waiting'))).toBeVisible();
  await expect(toggle).toBeChecked();

  // 2. The other owner sees the request and approves it with a code.
  const theirs = await openAs(browser, other, '/platform-owners?tab=approvals');
  await expect(
    theirs.getByRole('heading', {
      name: tc('platformOwners', 'approvals.scopes.platform.approvals_switch'),
    }),
  ).toBeVisible();
  await theirs
    .getByRole('button', { name: tc('platformOwners', 'approvals.approve'), exact: true })
    .click();
  await enterCode(theirs, other);
  await expect(theirs.getByText(tc('platformOwners', 'approvals.approved'))).toBeVisible();
  await theirs.context().close();

  // 3. The first owner repeats the action: it goes through, and the grant is used up.
  await toggle.click();
  await confirmDialog(mine, key('turnOffConfirm'));
  await enterCode(mine, dev);
  await expect(mine.getByText(key('turnedOff'))).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await expect(mine.getByText(tc('platformOwners', 'approvals.status.USED'))).toHaveCount(1);
  await expect(mine.getByText(tc('platformOwners', 'approvals.status.GRANTED'))).toHaveCount(0);
  await mine.context().close();
});
