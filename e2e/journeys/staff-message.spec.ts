import { get, post, put } from '../api';
import { newSchool } from '../fixtures/new-school';
import { expect, guest, test } from '../fixtures/test';
import { makeT } from '../i18n';

/**
 * [80.2.0x] Epic 80 wave-2 close: an admin messages staff in a real browser.
 *
 * Own data (shard-friendly): a school registered over the API, so no other worker shares it.
 * Its only staff member is the admin, who registered with a phone number, so the recipient is
 * known without seeding anyone. The admin is reached through the `?people=` link the staff list
 * uses (D13), which is itself part of the flow under test.
 *
 * Two legs:
 *  1. The school does not count credit: Send message -> Staff -> "All teachers" finds nobody
 *     (a fresh school has no teaching designation) -> the admin link finds one person ->
 *     check, send with the keyboard, see "Message on its way".
 *  2. The school switches to SchoolManagerP SMS with no credit: the check shows the shortfall
 *     and Send stays disabled.
 *
 * Not run in this lane (no stack): written against the real labels in
 * ui/src/i18n/locales/en/communications.json, and type-checked.
 */
const t = makeT('en');
test.use({ ...guest, e2eLocale: 'en', actionTimeout: 15_000 });

test('an admin messages staff: sends, then is stopped by a credit shortfall', async ({
  browser,
  playwright,
}) => {
  test.setTimeout(120_000);
  const school = await newSchool(browser, playwright);
  try {
    const { page } = school;
    await page.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));
    const me = await get<{ id: string }>(school.api, school.session, '/users/me');

    const message = `Staff meeting at 3pm ${Date.now()}`;
    const check = page.getByRole('button', {
      name: t('communications.staffMessage.preview.action'),
    });

    await test.step('Send message -> Staff opens the staff page', async () => {
      await page.goto('/communications/send');
      await page.getByRole('tab', { name: t('communications.staffMessage.switch.staff') }).click();
      await expect(
        page.getByRole('heading', { level: 1, name: t('communications.staffMessage.title') }),
      ).toBeVisible();
      // "All teachers" is on by default.
      await expect(
        page.getByRole('checkbox', { name: t('communications.staffMessage.audience.allTeachers') }),
      ).toBeChecked();
    });

    await test.step('a fresh school has no teachers: the check finds nobody and Send stays off', async () => {
      await page
        .getByRole('textbox', { name: t('communications.staffMessage.message.label') })
        .fill(message);
      const previewed = page.waitForResponse(
        (r) => r.url().includes('/communications/staff/preview') && r.request().method() === 'POST',
      );
      await check.click();
      await previewed;
      await expect(
        page.getByText(t('communications.staffMessage.preview.nobodyTitle')),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: t('communications.staffMessage.send.action'),
          exact: true,
        }),
      ).toBeDisabled();
    });

    await test.step('a teacher with a phone: the default All teachers send queues one', async () => {
      const stamp = Date.now();
      const teacher = await post<{ user: { id: string } }>(school.api, school.session, '/users', {
        full_name: `All Teachers Teacher ${stamp}`,
        phone: `017${String(stamp).slice(-8)}`,
        role: 'TEACHER',
        // With a password the account is ACTIVE right away; passwordless mints an
        // invite instead and an INVITED user is not in the staff audience.
        password: `E2e-${stamp}-pass`,
        tenantId: school.session.tenantId,
      });
      // "All teachers" means teaching staff: an open designation history row on a
      // designation marked is_teaching, not just the TEACHER role.
      const designation = await post<{ id: string }>(school.api, school.session, '/designations', {
        title_en: 'Class Teacher',
        is_teaching: true,
      });
      await post(
        school.api,
        school.session,
        `/staff-hr-records/${teacher.user.id}/promote`,
        {
          designation_id: designation.id,
          effective_date: new Date().toISOString().slice(0, 10),
        },
      );
      // A different text, so the just-sent duplicate rule never answers instead.
      await page.goto('/communications/send');
      await page.getByRole('tab', { name: t('communications.staffMessage.switch.staff') }).click();
      await expect(
        page.getByRole('checkbox', { name: t('communications.staffMessage.audience.allTeachers') }),
      ).toBeChecked();
      await page
        .getByRole('textbox', { name: t('communications.staffMessage.message.label') })
        .fill(`${message} (all teachers)`);
      const previewed = page.waitForResponse(
        (r) => r.url().includes('/communications/staff/preview') && r.request().method() === 'POST',
      );
      await check.click();
      await previewed;
      const send = page.getByRole('button', {
        name: t('communications.staffMessage.send.action'),
        exact: true,
      });
      await expect(send).toBeEnabled();
      const sent = page.waitForResponse(
        (r) =>
          r.url().includes('/communications/staff') &&
          r.request().method() === 'POST' &&
          !r.url().includes('/preview'),
      );
      await send.click();
      await page
        .getByRole('button', { name: t('communications.staffMessage.send.confirm') })
        .click();
      expect(await (await sent).json()).toMatchObject({ queued: 1 });
      await expect(
        page.getByRole('heading', { name: t('communications.staffMessage.send.successTitle') }),
      ).toBeVisible();
      await expect(
        page.getByText(t('communications.staffMessage.send.successDescription', { queued: 1 })),
      ).toBeVisible();
    });

    await test.step('the staff-list link picks the admin; check and send by keyboard', async () => {
      await page.goto(`/communications/staff-message?people=${me.id}`);
      await expect(
        page.getByText(t('communications.staffMessage.entry.prefillHelp')),
      ).toBeVisible();
      await page
        .getByRole('textbox', { name: t('communications.staffMessage.message.label') })
        .fill(message);

      // Keyboard path: focus the check button and press Enter.
      const previewed = page.waitForResponse(
        (r) => r.url().includes('/communications/staff/preview') && r.request().method() === 'POST',
      );
      await check.focus();
      await page.keyboard.press('Enter');
      await previewed;
      // One person, with a phone, so one send is possible.
      const send = page.getByRole('button', {
        name: t('communications.staffMessage.send.action'),
        exact: true,
      });
      await expect(send).toBeEnabled();

      const sent = page.waitForResponse(
        (r) =>
          r.url().includes('/communications/staff') &&
          r.request().method() === 'POST' &&
          !r.url().includes('/preview'),
      );
      await send.focus();
      await page.keyboard.press('Enter');
      await page
        .getByRole('button', { name: t('communications.staffMessage.send.confirm') })
        .click();
      expect((await sent).ok()).toBe(true);
      await expect(
        page.getByRole('heading', { name: t('communications.staffMessage.send.successTitle') }),
      ).toBeVisible();
      await expect(
        page.getByText(t('communications.staffMessage.send.successDescription', { queued: 1 })),
      ).toBeVisible();
    });

    await test.step('with SchoolManagerP SMS and no credit the check shows the shortfall', async () => {
      await put(school.api, school.session, '/communications/sms-source', {
        source: 'SCHOOLMANAGERP',
      });
      // A different text, so the "just sent" duplicate rule does not answer instead.
      await page.goto(`/communications/staff-message?people=${me.id}`);
      await page
        .getByRole('textbox', { name: t('communications.staffMessage.message.label') })
        .fill(`${message} (second)`);
      const previewed = page.waitForResponse(
        (r) => r.url().includes('/communications/staff/preview') && r.request().method() === 'POST',
      );
      await check.click();
      await previewed;
      await expect(
        page.getByText(t('communications.staffMessage.preview.shortfall', { count: 1 })),
      ).toBeVisible();
      await expect(
        page.getByRole('button', {
          name: t('communications.staffMessage.send.action'),
          exact: true,
        }),
      ).toBeDisabled();
    });
  } finally {
    await school.api.dispose();
  }
});
