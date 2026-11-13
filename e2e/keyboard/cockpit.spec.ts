import {
  apiEnrol,
  apiSignIn,
  clearCodes,
  devOwner,
  emailCode,
  expect,
  freshTotp,
  fullNameOf,
  newOwner,
  resetOwners,
  setApprovals,
  smsCode,
  stubLegacyPlatformRoutes,
  tc,
  test,
  warmUp,
  type Owner,
} from '../cockpit/helpers';

/**
 * [98.4.99] One keyboard journey for the cockpit (one spec per nav group, U3): sign-in without the
 * mouse, then "lock an owner" from the command palette. Runs in the `cockpit` project only (see
 * playwright.config.ts). No mouse calls anywhere in this file.
 */
test.describe.configure({ mode: 'serial', timeout: 180_000 });

let owner: Owner;
let target: Owner;

test.beforeAll(async ({ playwright, browser }) => {
  await warmUp(browser, ['/sign-in']);
  await resetOwners();
  await setApprovals(false); // one code per lock: the gated path is covered in cockpit-owners.spec.ts
  owner = await devOwner();
  target = await newOwner('Keyboard Target');
  const api = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL! });
  await apiEnrol(api, target);
  await api.dispose();
});

test.afterAll(async () => {
  await resetOwners();
});

test('sign-in by keyboard: password, authenticator code, new-device codes', async ({
  page,
  request,
}) => {
  await clearCodes(request, owner);
  await page.goto('/sign-in');
  await page.waitForLoadState('networkidle');

  // The identifier field has focus on arrival (useFocusFirst); Tab moves to the password.
  await expect(page.getByLabel(tc('cockpit', 'signIn.identifierLabel'))).toBeFocused();
  await page.keyboard.type(owner.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(owner.password);
  await page.keyboard.press('Enter');

  await expect(page.getByLabel(tc('cockpit', 'signIn.code.label')).first()).toBeFocused();
  await page.keyboard.type(await freshTotp(owner.secret!));
  await page.keyboard.press('Enter');

  await expect(
    page.getByRole('heading', { name: tc('cockpit', 'signIn.device.title') }),
  ).toBeVisible();
  await expect(page.getByLabel(tc('cockpit', 'signIn.device.smsLabel')).first()).toBeFocused();
  await page.keyboard.type(await smsCode(request, owner));
  await page.keyboard.press('Tab');
  await page.keyboard.type(await emailCode(request, owner));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/platform-owners/);
});

test('lock an owner from the command palette, keyboard only', async ({ page, request }) => {
  // The previous test left a session in its own page; this one opens the owners page by keyboard.
  await clearCodes(request, owner);
  await page.goto('/sign-in?redirect=%2Fplatform-owners');
  await page.waitForLoadState('networkidle');
  await page.keyboard.type(owner.email);
  await page.keyboard.press('Tab');
  await page.keyboard.type(owner.password);
  await page.keyboard.press('Enter');
  // Each step renders in place; wait for its field to have focus before typing into it.
  await expect(page.getByLabel(tc('cockpit', 'signIn.code.label')).first()).toBeFocused();
  await page.keyboard.type(await freshTotp(owner.secret!));
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(tc('cockpit', 'signIn.device.smsLabel')).first()).toBeFocused();
  await page.keyboard.type(await smsCode(request, owner));
  await page.keyboard.press('Tab');
  await page.keyboard.type(await emailCode(request, owner));
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/platform-owners/);
  await page.waitForLoadState('networkidle'); // the shortcut is wired once the page is up

  // Palette: the cockpit action registry labels are not in the i18n catalogs; this is the bn label
  // of `platform-owners.lock` (client-admin/src/action-registry.ts).
  // The shortcut is wired a moment after the page shows (dev server): press again until it opens.
  const palette = page.getByRole('combobox', { name: tc('nav', 'commandPalette.ariaLabel') });
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press('ControlOrMeta+k');
    await expect(palette).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await expect(palette).toBeFocused();
  await page.keyboard.type('প্ল্যাটফর্ম মালিককে লক করুন');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/tab=owners/);

  // Tab to the target's Lock button, open the confirmation, confirm, type the code.
  const name = await fullNameOf(target.email);
  const lock = page
    .getByRole('group', { name })
    .getByRole('button', { name: tc('platformOwners', 'owners.lock'), exact: true });
  await expect(lock).toBeVisible();
  for (let i = 0; i < 80 && !(await lock.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press('Tab');
  }
  await expect(lock).toBeFocused();
  await page.keyboard.press('Enter');
  const confirm = page
    .getByRole('alertdialog')
    .or(page.getByRole('dialog'))
    .getByRole('button', { name: tc('platformOwners', 'owners.lock'), exact: true });
  await expect(confirm).toBeVisible();
  await confirm.focus(); // the dialog opens with focus inside it; the button is one Tab away at most
  await page.keyboard.press('Enter');
  const codeLabel = tc('approval', 'codeOnly.label');
  await expect(page.getByLabel(codeLabel)).toBeFocused();
  await page.keyboard.type(await freshTotp(owner.secret!));
  await page.keyboard.press('Enter');
  await expect(page.getByText(tc('platformOwners', 'owners.locked', { name }))).toBeVisible();
});

/**
 * [99.5.16] The five Epic 99 palette actions (D12), owner on the cockpit host, keyboard only. Labels
 * are the bn ones from `action-registry.ts`; the session comes from the API so each case is one
 * palette run. "Login as" only opens the schools list (the palette has no school id).
 */
const PLATFORM_ACTION_CASES = [
  { query: 'হিসেবে ঢুকুন', url: /\/schools$/ },
  { query: 'হিসেবে ঢোকা শেষ করুন', url: /\/schools$/ },
  { query: 'ব্যবহারকারী খুঁজুন', url: /\/users$/ },
  { query: 'নতুন ঘোষণা', url: /\/announcements$/ },
  { query: 'কিউ', url: /\/operations$/ },
];

for (const { query, url } of PLATFORM_ACTION_CASES) {
  test(`palette action "${query}" opens its page, keyboard only`, async ({ page }) => {
    await apiSignIn(page.request, owner);
    await stubLegacyPlatformRoutes(page.context());
    await page.goto('/platform-owners');
    await page.waitForLoadState('networkidle');

    const palette = page.getByRole('combobox', { name: tc('nav', 'commandPalette.ariaLabel') });
    await expect(async () => {
      if (!(await palette.isVisible())) await page.keyboard.press('ControlOrMeta+k');
      await expect(palette).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await page.keyboard.type(query);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(url);
  });
}
