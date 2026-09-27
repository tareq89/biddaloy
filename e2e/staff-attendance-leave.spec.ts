import { adminApiSession, get, post } from './api';
import { expect, loggedIn, test } from './fixtures/test';
import { t } from './i18n';
import { tabUntilFocused } from './keyboard/keyboard-utils';

/**
 * [36.4.5/#1102] Epic 36's two client screens (`Attendance → Staff` and
 * `Leave`), KEYBOARD ONLY — no `page.mouse`, no `.click(`. Marks one staff
 * member present via the command palette + Tab/Enter, then submits a leave
 * request via the same keyboard model, and finally proves the balance
 * actually moves once the request is approved.
 *
 * The leave-approve list in the UI is a disclosed placeholder (no
 * `GET /leave/requests` list endpoint exists yet — see
 * `-leave-approve-list.tsx`'s own comment), so "approve it" here goes
 * through the API directly (`POST /leave/requests/:id/decide`) rather than
 * a UI panel that cannot exist until that endpoint ships.
 */

test.use(loggedIn('admin'));

// [36.4] `action-registry.ts`'s `attendance.markStaff` action label is a
// hardcoded `{ en, bn }` pair, not a `t()` catalog key — the default e2e
// locale is `bn` (`i18n.ts`'s `DEFAULT_LOCALE`), so this must match that
// literal Bangla string exactly, not a translation lookup.
const MARK_STAFF_ATTENDANCE_ACTION_LABEL = 'কর্মী হাজিরা নিন';

test('staff attendance + leave request/approval, keyboard only', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const me = await get<{ id: string; full_name: string; staff_profile_id: string | null }>(
    request,
    session,
    '/users/me',
  );
  if (!me.staff_profile_id) {
    throw new Error('seeded admin has no staff_profile_id — seed.util.ts ensureStaffHrSeed gap');
  }

  const balanceBefore = await get<{ leave_type: string; balance: number }[]>(
    request,
    session,
    `/leave/balance?staff_profile_id=${me.staff_profile_id}`,
  );
  const casualBefore = balanceBefore.find((row) => row.leave_type === 'CASUAL');
  if (!casualBefore) throw new Error('no CASUAL leave policy seeded for this tenant');

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

    // Selecting the palette action returns focus to whatever opened the
    // palette (the header's search trigger), not the new route's content —
    // continuing to Tab from there walks through header chrome first,
    // including the account-menu button, whose aria-label
    // (`"${accountMenuLabel} — ${name}"`, `user-menu.tsx`) also contains
    // `me.full_name` and would false-positive-match the hunt below, then
    // Enter would open that menu and trap every later Tab inside it. Same
    // skip-link jump `focus-management.spec.ts` uses to reach
    // `#main-content` directly, bypassing header/sidebar chrome entirely.
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await tabUntilFocused(page, me.full_name, 60, { tag: 'BUTTON' });
    await page.keyboard.press('Enter'); // AttendanceStatusControl row shortcut: PRESENT
    await tabUntilFocused(page, t('staffAttendance.grid.submit'), 20, { tag: 'BUTTON' });
    const [markResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/staff-attendance/register') && r.request().method() === 'PUT',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(markResponse.ok()).toBe(true);
    await expect(page.getByText(t('staffAttendance.grid.saved'))).toBeVisible();
  });

  let leaveRecordId = '';

  await test.step('reach the leave screen via keyboard', async () => {
    await tabUntilFocused(page, t('nav.items.leave'), 20, { tag: 'A' });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('leave.myLeave.title') })).toBeVisible();
  });

  await test.step('open the request dialog and submit a leave request', async () => {
    await tabUntilFocused(page, t('leave.myLeave.requestButton'), 20, { tag: 'BUTTON' });
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('leave.request.title') })).toBeVisible();

    // Leave type stays the default (CASUAL) — the ticket only asks for a
    // request to exist, not to exercise the type dropdown.
    const startInput = page.getByLabel(t('leave.request.startDateLabel'));
    await startInput.focus();
    await page.keyboard.type('03/10/2026');

    const endInput = page.getByLabel(t('leave.request.endDateLabel'));
    await endInput.focus();
    await page.keyboard.type('03/11/2026');

    const reasonInput = page.getByLabel(t('leave.request.reasonLabel'));
    await reasonInput.focus();
    await page.keyboard.type('Keyboard e2e leave request');

    const submitButton = page.getByRole('button', { name: t('leave.request.submit') });
    await submitButton.focus();
    const [requestResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/leave/requests') && r.request().method() === 'POST',
      ),
      page.keyboard.press('Enter'),
    ]);
    expect(requestResponse.ok()).toBe(true);
    const created = (await requestResponse.json()) as { id: string };
    leaveRecordId = created.id;
    // The dialog closes on success (`onSuccess: () => onOpenChange(false)`).
    await expect(page.getByRole('heading', { name: t('leave.request.title') })).toBeHidden();
  });

  await test.step('approve it via the API (no approve-list UI exists yet), then assert the balance decreased', async () => {
    if (!leaveRecordId) throw new Error('leave request never returned an id');
    await post(request, session, `/leave/requests/${leaveRecordId}/decide`, { approve: true });

    await page.reload();
    await expect(page.getByRole('heading', { name: t('leave.myLeave.title') })).toBeVisible();

    const balanceAfter = await get<{ leave_type: string; balance: number }[]>(
      request,
      session,
      `/leave/balance?staff_profile_id=${me.staff_profile_id}`,
    );
    const casualAfter = balanceAfter.find((row) => row.leave_type === 'CASUAL');
    if (!casualAfter) throw new Error('CASUAL policy disappeared after approval');
    expect(casualAfter.balance).toBeLessThan(casualBefore.balance);
  });
});
