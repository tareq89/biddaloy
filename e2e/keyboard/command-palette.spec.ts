import { adminApiSession, createStudent } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { focusedText } from './keyboard-utils';

/**
 * [30.4.3]/[30.5.1] `CommandPalette`, keyboard only. Replaces
 * `global-search.spec.ts` ([8.5.6]) — that file only ever exercised the
 * old single-list `GlobalSearch`, which this ticket retires. No mouse
 * calls anywhere in this file.
 */

test.use(loggedIn('admin'));

test('command palette is fully keyboard-drivable: People tab search and pick', async ({
  page,
  request,
}) => {
  const session = await adminApiSession(request);
  const name = `Kbd Search ${Date.now()}`;
  await createStudent(request, session, name);

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('open with the shortcut', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(
      page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') }),
    ).toBeFocused();
  });

  await test.step('query, arrow down, Enter', async () => {
    await page.keyboard.type(name);
    await expect(page.getByRole('option', { name }).first()).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  });

  await test.step('landed on the student detail', async () => {
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  });

  // [30.3.3] The palette lands on `/students/$studentId`, which renders
  // a "Students · <name>" breadcrumb trail (`use-breadcrumbs.ts`) — the
  // "Students" crumb is a real `Link`, reachable and operable without a
  // mouse, same as everything else this file asserts. The sidebar also
  // has a "Students" link with the exact same accessible text and sits
  // much earlier in tab order (it's rendered before `<main>`), so this
  // uses the skip link (`focus-management.spec.ts`'s own pattern) to jump
  // straight past the sidebar into `#main-content`, then confirms the
  // very next Tab stop — the breadcrumb, the first focusable thing inside
  // `<main>` — is the crumb we actually mean, not the sidebar's look-alike.
  await test.step('Tab into the breadcrumb list link and follow it back', async () => {
    const studentsLabel = t('nav.items.students');

    // Reset the Tab cursor to the top of the document — `useRouteFocus`
    // already moved focus to the page's `<h1>`, and Tab from there
    // wouldn't reach the skip link (see `focus-management.spec.ts`'s
    // identical comment on this exact reset).
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'মূল বিষয়বস্তুতে যান' })).toBeFocused();
    await page.keyboard.press('Enter');
    // Focus moves to `#main-content` itself first (see
    // `focus-management.spec.ts`'s own assertion on this same jump) —
    // waiting for that to settle before the next Tab avoids a race where
    // a slower render (seen in CI, not reproduced locally) leaves this
    // Tab firing before focus has actually landed there.
    await expect(page.locator('#main-content')).toBeFocused();

    await page.keyboard.press('Tab');
    expect(await focusedText(page)).toBe(studentsLabel);
    const inBreadcrumb = await page.evaluate(
      () => document.activeElement?.closest('[data-slot="breadcrumbs"]') !== null,
    );
    expect(inBreadcrumb).toBe(true);

    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { level: 1, name: studentsLabel })).toBeVisible();
  });
});

test('Ctrl+3 jumps to the Action tab and a `navigate`-kind action runs, mouse-free', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();

  await test.step('Ctrl+3 switches to the Action tab', async () => {
    await page.keyboard.press('Control+3');
    await expect(
      page.getByRole('tab', { name: t('nav.commandPalette.tabs.action') }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  await test.step('query an action, Enter runs it', async () => {
    await page.keyboard.type(t('nav.items.students'));
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
  });

  await test.step('the action navigated to the real URL, not the internal route id', async () => {
    // Un-anchored, this would also match the pathless-layout-prefixed
    // `/_staff/students/new` as a substring — anchor it so a regression
    // like that (a real bug CodeRabbit caught: action-registry.ts's
    // navigate() targets carried the internal `/_staff/...` route id
    // instead of the real path) fails loudly instead of passing by luck.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/students\/(new|import)$/);
  });
});

test('Tab moves focus out of the palette input, switching tabs does not trap it (D11)', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await page.keyboard.press('ControlOrMeta+k');
  const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
  await expect(input).toBeFocused();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: t('nav.commandPalette.tabs.page') })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  // Native browser Tab semantics stay unbound (D11) — focus leaves the
  // input for the next focusable element rather than roving between the
  // `role="tab"` triggers.
  await page.keyboard.press('Tab');
  await expect(input).not.toBeFocused();
});
