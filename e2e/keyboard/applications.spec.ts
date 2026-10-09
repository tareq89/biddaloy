import type { Page } from '@playwright/test';

import { adminApiSession, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { fileStudentLeave } from '../responsive/routes';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';

import { focusedText, tabUntilFocused } from './keyboard-utils';

// [52.5.8] D25: the class teacher works the inbox without a mouse. nav -> list -> row -> Approve
// -> note -> Enter -> back on the list with focus on the row that took the decided one's place.

const ROW_VIEW = /^আবেদন (\S+) খুলুন$/;
const isDecide = (url: string, verb: 'approve' | 'reject') =>
  /\/api\/v1\/applications\/[0-9a-f-]{36}\/(approve|reject)$/.test(url) && url.endsWith(verb);

async function viewSerial(label: string): Promise<string> {
  const serial = ROW_VIEW.exec(label)?.[1];
  if (!serial) throw new Error(`not a row view action: "${label}"`);
  return serial;
}

/**
 * `openFromSidebar` matches the link text exactly, but the Applications link carries a pending
 * badge once the count has loaded ("আবেদনপত্র ৪টি অপেক্ষমাণ"), so wait for it and match by prefix.
 */
async function openApplicationsFromSidebar(page: Page): Promise<void> {
  const label = t('nav.items.applications');
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
  await expect(
    page.getByRole('navigation').getByRole('link', { name: label }).first(),
  ).toContainText(/[০-৯]/);
  await page.evaluate(() => {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  await tabUntilFocused(page, label, 150, { tag: 'a' });
  await page.keyboard.press('Enter');
  const heading = page.getByRole('heading', { level: 1, name: label, exact: true });
  await expect(heading).toBeFocused();
}

test.describe('applications inbox (teacher), keyboard only', () => {
  test.use(loggedIn('teacher'));

  // Each test works its OWN row (found by serial) and a second one stays behind as the "next" row,
  // so shards running in parallel, and reruns on one database, never consume each other's.
  let mine: string;
  test.beforeEach(async ({ request }) => {
    const password = process.env[SEED_PASSWORD_ENV];
    if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
    const login = await request.post('/api/v1/auth/login', {
      data: { email: SEED_ROLE_EMAILS.teacher, password },
    });
    const body = (await login.json()) as {
      access_token: string;
      memberships: { tenantId: string }[];
    };
    const teacher = { token: body.access_token, tenantId: body.memberships[0]!.tenantId };
    const inbox = await get<{ data: { subject_student_id: string | null }[] }>(
      request,
      teacher,
      '/applications?view=inbox',
    );
    const studentId = inbox.data.find((a) => a.subject_student_id)?.subject_student_id;
    if (!studentId) throw new Error('teacher inbox has no student application (seed)');
    const admin = await adminApiSession(request);
    mine = (await fileStudentLeave(request, admin, studentId)).serial;
    await fileStudentLeave(request, admin, studentId);
  });

  test('approve: nav -> row -> Approve -> note -> Enter -> focus on the next row', async ({
    page,
  }) => {
    await openApplicationsFromSidebar(page);
    await expect(page).toHaveURL(/\/applications(\?|$)/);
    await expect(
      page.getByRole('tab', { name: new RegExp(t('applicationsList.tabs.inbox')) }),
    ).toHaveAttribute('aria-selected', 'true');

    // This test's own row.
    await tabUntilFocused(page, `আবেদন ${mine} খুলুন`, 250, { exact: true });
    const approvedSerial = mine;
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}\?from=inbox/);
    const approve = page.locator('[data-action-id="approve"]');
    await expect(approve).toBeFocused();
    await expect(approve).toHaveText(t('applicationsDetail.actions.approve'));

    await page.keyboard.press('Enter');
    const note = page.getByLabel(t('applicationsDetail.dialogs.noteLabel'));
    await expect(note).toBeFocused();
    await page.keyboard.type('ঠিক আছে');
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && isDecide(r.url(), 'approve')),
      page.keyboard.press('Enter'),
    ]);
    expect(response.status()).toBe(200);

    // Back on the inbox, `decided` consumed, focus on the view action of the next row.
    await expect(page).toHaveURL(/\/applications\?view=inbox$/);
    await expect
      .poll(async () => ROW_VIEW.test(await focusedText(page)), { timeout: 10_000 })
      .toBe(true);
    expect(await viewSerial(await focusedText(page))).not.toBe(approvedSerial);
  });

  test('reject: row reject icon -> reason -> Enter', async ({ page }) => {
    await openApplicationsFromSidebar(page);
    await tabUntilFocused(page, `আবেদন ${mine} খুলুন`, 250, { exact: true });
    const serial = mine;
    // Row actions are view, approve, reject in that order.
    await tabUntilFocused(page, `আবেদন ${serial} নামঞ্জুর করুন`, 3);
    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/applications\/[0-9a-f-]{36}\?from=inbox/);
    const reason = page.getByLabel(t('applicationsDetail.dialogs.reject.reasonLabel'));
    await expect(reason).toBeFocused();
    await page.keyboard.type('কাগজপত্র অসম্পূর্ণ');
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.request().method() === 'POST' && isDecide(r.url(), 'reject')),
      page.keyboard.press('Enter'),
    ]);
    expect(response.status()).toBe(200);
    await expect(page).toHaveURL(/\/applications\?view=inbox$/);
  });
});
