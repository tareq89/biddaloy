import { adminApiSession, get } from './api';
import { expect, loggedIn, test } from './fixtures/test';
import { t } from './i18n';

/**
 * [36.4.5/#1102] Epic 36's staff attendance screen, KEYBOARD ONLY — no `page.mouse`, no
 * `.click(`. Marks one staff member present via the command palette + Tab/Enter.
 *
 * The leave half moved to the applications flow (D20, [52.5.2]); its end-to-end journey is
 * covered by the applications specs.
 */

test.use(loggedIn('admin'));

// [36.4] `action-registry.ts`'s `attendance.markStaff` action label is a
// hardcoded `{ en, bn }` pair, not a `t()` catalog key — the default e2e
// locale is `bn` (`i18n.ts`'s `DEFAULT_LOCALE`), so this must match that
// literal Bangla string exactly, not a translation lookup.
const MARK_STAFF_ATTENDANCE_ACTION_LABEL = 'কর্মীর উপস্থিতি নিন';

test('staff attendance, keyboard only', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const me = await get<{ id: string; full_name: string }>(request, session, '/users/me');

  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

  await test.step('open the command palette and run "Mark staff attendance"', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    const input = page.getByRole('combobox', { name: t('nav.commandPalette.ariaLabel') });
    await expect(input).toBeFocused();
    await page.keyboard.press('Control+3'); // Action tab — see command-palette.spec.ts
    await page.keyboard.type(MARK_STAFF_ATTENDANCE_ACTION_LABEL);
    await expect(page.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
  });

  await test.step('mark the admin present via keyboard and save', async () => {
    await expect(
      page.getByRole('heading', { name: t('staffAttendance.grid.title') }),
    ).toBeVisible();

    // `.focus()` on a precise locator, same pattern
    // `command-palette.spec.ts`'s own comment documents as the deliberate
    // replacement for Tab-counting: it still drives real DOM focus (not a
    // mouse event) and Enter still fires the browser's real
    // keydown-activation path, proving the element is genuinely
    // keyboard-operable without depending on how many Tab stops away it
    // happens to sit — which, for this grid, grows with the tenant's whole
    // staff roster (`index.tsx`'s own `useUsers({ limit: 200 })` comment),
    // not a fixed constant. The row's own name button
    // (`-staff-attendance-grid.tsx`) has an EXACT accessible name (just
    // `user.full_name`, no extra text), scoped to the grid's own
    // `<ul aria-label>` so it can't match the header's account-menu button
    // (whose aria-label also contains the name, as a substring).
    const row = page
      .getByRole('list', { name: t('staffAttendance.grid.title') })
      .getByRole('button', { name: me.full_name, exact: true });
    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press('Enter'); // AttendanceStatusControl row shortcut: PRESENT

    const submitButton = page.getByRole('button', { name: t('staffAttendance.grid.submit') });
    await submitButton.focus();
    const [markResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/staff-attendance/register') && r.request().method() === 'PUT',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(markResponse.ok()).toBe(true);
    await expect(page.getByText(t('staffAttendance.grid.saved'))).toBeVisible();
  });
});
