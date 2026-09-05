import { adminApiSession, createStudentsInSection, createTeacherForSection } from '../api';
import { shells } from '../config';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';
import { tabUntilFocused } from './keyboard-utils';

/**
 * [9.6] Teacher marking, KEYBOARD ONLY. This file contains no
 * `page.mouse` and no `.click(` call — grep it. Navigation is
 * exclusively Tab / Enter / Arrow keys / the roster's own shortcuts
 * (`Shift+P` marks every row present, `ControlOrMeta+Enter` submits).
 *
 * A freshly-created teacher (not the shared `loggedIn('teacher')` seed
 * account) is used here, mapped to a freshly-created section — the
 * seeded account's section mappings must never be mutated by an
 * individual spec, since other specs use it purely for role checks and
 * may run in a parallel worker.
 */

test('teacher marks and submits a whole section without touching the mouse', async ({
  browser,
  request,
}) => {
  const admin = await adminApiSession(request);
  const chain = await createStudentsInSection(request, admin, 'Keyboard Student', 5);
  const teacher = await createTeacherForSection(
    request,
    admin,
    'Keyboard Teacher',
    chain.sectionId,
  );

  const response = await request.post('/api/v1/auth/login', {
    data: { email: teacher.email, password: teacher.password },
  });
  if (!response.ok()) {
    throw new Error(`teacher login failed: ${response.status()} ${await response.text()}`);
  }
  const body = (await response.json()) as { memberships: { tenantId: string; role: string }[] };
  const membership = body.memberships[0];
  if (!membership) throw new Error('no membership for freshly-created teacher');
  const state = await request.storageState();
  const context = await browser.newContext({
    baseURL: shells.app.baseURL,
    storageState: {
      cookies: state.cookies,
      origins: [
        {
          origin: shells.app.baseURL.replace(/\/$/, ''),
          localStorage: [
            {
              name: 'biddaloy:activeTenant',
              value: JSON.stringify({ tenantId: membership.tenantId, role: membership.role }),
            },
          ],
        },
      ],
    },
  });
  const page = await context.newPage();

  await test.step('skip link, then keyboard-navigate to attendance', async () => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    // Reset the tab cursor to the top of the document — route focus has
    // already moved focus to the page heading.
    await page.evaluate(() => {
      document.body.setAttribute('tabindex', '-1');
      document.body.focus();
      document.body.removeAttribute('tabindex');
    });
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t('nav.skipToContent') })).toBeFocused();
    await tabUntilFocused(page, t('nav.items.attendance'));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: t('attendance.list.title') })).toBeVisible();
  });

  await test.step('open the only mapped section', async () => {
    await tabUntilFocused(page, chain.className);
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('heading', { name: `${chain.className} A`, exact: false }),
    ).toBeVisible();
  });

  await test.step('reach the roster, mark everyone present, submit', async () => {
    await tabUntilFocused(page, 'Keyboard Student 01', 40, { tag: 'BUTTON' });
    await page.keyboard.press('Shift+P');
    await expect(page.getByText(t('attendance.mark.presentCount', { n: 5 }))).toBeVisible();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByRole('heading', { name: t('attendance.list.title') })).toBeVisible();
  });

  await test.step('the server actually recorded it', async () => {
    // `request` here is the top-level fixture context — it was never
    // authenticated as the teacher (only used to mint the browser
    // context's storage state above), so log it in fresh before reading.
    const relogin = await request.post('/api/v1/auth/login', {
      data: { email: teacher.email, password: teacher.password },
    });
    const relogged = (await relogin.json()) as { access_token: string };
    const verified = await request.get(`/api/v1/attendance/sections/${chain.sectionId}/register`, {
      headers: {
        Authorization: `Bearer ${relogged.access_token}`,
        'X-Tenant-ID': membership.tenantId,
      },
      params: { date: new Date().toISOString().slice(0, 10) },
    });
    if (!verified.ok()) {
      throw new Error(`GET register failed: ${verified.status()} ${await verified.text()}`);
    }
    const register = (await verified.json()) as { students: { status: string | null }[] };
    expect(register.students).toHaveLength(5);
    expect(register.students.every((s) => s.status === 'PRESENT')).toBe(true);
  });
});
