import type { Page } from '@playwright/test';

import { adminApiSession, get, post } from './api';
import { expect, loggedIn, test } from './fixtures/test';
import { t } from './i18n';

/**
 * [36.4.5/#1102] Epic 36's two client screens (`Attendance → Staff` and
 * `Leave`), KEYBOARD ONLY — no `page.mouse`, no `.click(` (bar the kit DatePicker). Marks one staff
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

async function pickDate(page: Page, label: string, iso: string) {
  await page.getByLabel(label).click();
  const cell = page.locator(`[role="grid"] [data-date="${iso}"]`);
  for (let i = 0; i < 24 && !(await cell.isVisible()); i++) {
    await page.getByRole('button', { name: t('common.date.previousMonth') }).click();
  }
  await cell.click();
}

// [36.4] `action-registry.ts`'s `attendance.markStaff` action label is a
// hardcoded `{ en, bn }` pair, not a `t()` catalog key — the default e2e
// locale is `bn` (`i18n.ts`'s `DEFAULT_LOCALE`), so this must match that
// literal Bangla string exactly, not a translation lookup.
const MARK_STAFF_ATTENDANCE_ACTION_LABEL = 'কর্মীর উপস্থিতি নিন';

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

  let leaveRecordId = '';

  await test.step('reach the leave screen via keyboard', async () => {
    const leaveLink = page.getByRole('link', { name: t('nav.items.leave') });
    await leaveLink.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('leave.myLeave.title') })).toBeVisible();
  });

  await test.step('open the request dialog and submit a leave request', async () => {
    const requestButton = page.getByRole('button', { name: t('leave.myLeave.requestButton') });
    await requestButton.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('leave.request.title') })).toBeVisible();

    // Leave type stays the default (CASUAL) — the ticket only asks for a
    // request to exist, not to exercise the type dropdown.
    //
    // Dates go through the kit `DatePicker`: open it, step back to the target
    // month (capped), then click the day cell. Real clicks on purpose — this
    // control has no text input to `.fill()`.
    await pickDate(page, t('leave.request.startDateLabel'), '2026-03-10');
    await pickDate(page, t('leave.request.endDateLabel'), '2026-03-11');

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
