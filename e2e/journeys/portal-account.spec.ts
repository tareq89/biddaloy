import { adminApiSession, apiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';
import { t } from '../i18n';

/**
 * [8.14.4] `/portal/account` — the first screen anywhere to consume
 * `PATCH /users/me`, `GET`/`PATCH /guardians/mine`, and `POST
 * /auth/change-password`.
 *
 * Selectors here are mostly the stable HTML `id`s each form field carries
 * (`ui/src/components/*-form.tsx`) rather than translated label text —
 * `e2e/i18n.ts`'s catalog map does not cover the `portal` namespace (out
 * of this ticket's touched-file list), and the suite's default locale is
 * `bn`, so a hardcoded English string would be locale-fragile. The one
 * exception is the nav link, which resolves through `nav`'s
 * `items.portalAccount` — already registered.
 *
 * Field ids, for reference: `#account-full-name`, `#account-email`,
 * `#account-phone`, `#account-current-password` (`profile-form.tsx`);
 * `#account-guardian-phone`, `#account-guardian-alternate-phone`,
 * `#account-guardian-email` (`guardian-contact-form.tsx`);
 * `#account-change-current-password`, `#account-change-new-password`,
 * `#account-change-confirm-password` (`change-password-form.tsx`).
 */

interface ReminderPreviewRecipient {
  address: string;
}

interface ReminderPreviewResponse {
  recipients: ReminderPreviewRecipient[];
}

interface StudentSummary {
  id: string;
}

test.use(loggedIn('parent'));

test('the phone AC end to end: a guardian-contact edit changes what the reminder preview dials', async ({
  page,
  request,
}) => {
  // `BD_PHONE_REGEX` (`server/src/modules/students/dto/students.dto.ts`)
  // requires the local part to match `1[3-9]\d{8}` — force the second
  // digit into that range so this doesn't intermittently fail depending
  // on what `Date.now()` happens to end in.
  const newPhone = `1${3 + (Date.now() % 7)}${Date.now().toString().slice(-8)}`;

  const parentSession = await apiSession(request, 'parent');
  const studentsResponse = await request.get('/api/v1/students/mine', {
    headers: {
      Authorization: `Bearer ${parentSession.token}`,
      'X-Tenant-ID': parentSession.tenantId,
    },
  });
  expect(studentsResponse.ok()).toBe(true);
  const students = (await studentsResponse.json()) as StudentSummary[];
  const studentId = students[0]?.id;
  if (!studentId) throw new Error('seeded parent has no linked student');

  await test.step('navigate to /portal/account via the nav link', async () => {
    await page.goto('/portal');
    await page.getByRole('link', { name: t('nav.items.portalAccount') }).click();
    await expect(page.locator('#account-guardian-phone')).toBeVisible();
  });

  await test.step('change the guardian contact phone number and save', async () => {
    const phoneField = page.locator('#account-guardian-phone');
    await phoneField.fill(newPhone);
    await page.locator('#account-guardian-phone').press('Tab');
    await page
      .locator('form', { has: page.locator('#account-guardian-phone') })
      .getByRole('button', { name: /./ })
      .last()
      .click();
    // The mutation settling is the stable confirmation — no client-side
    // navigation follows a successful save on this page.
    await expect(phoneField).toBeEnabled();
  });

  await test.step('the reminder-preview endpoint now dials the new number', async () => {
    const adminSession = await adminApiSession(request);
    const previewResponse = await request.post(
      `/api/v1/communications/reminder/single/${studentId}/preview`,
      {
        headers: {
          Authorization: `Bearer ${adminSession.token}`,
          'X-Tenant-ID': adminSession.tenantId,
        },
        data: { message_template: 'Reminder: fees are due for {{student_name}}.' },
      },
    );
    expect(previewResponse.ok()).toBe(true);
    const preview = (await previewResponse.json()) as ReminderPreviewResponse;
    const addresses = preview.recipients.map((recipient) => recipient.address);
    expect(addresses.some((address) => address.includes(newPhone))).toBe(true);
  });
});

test('password change: this device stays signed in, and the new password works on the next login', async ({
  page,
  context,
}) => {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const newPassword = `${password}-tmp-${Date.now()}`;

  try {
    await test.step('change the password from /portal/account', async () => {
      await page.goto('/portal/account');
      await page.locator('#account-change-current-password').fill(password);
      await page.locator('#account-change-new-password').fill(newPassword);
      await page.locator('#account-change-confirm-password').fill(newPassword);
      await page
        .locator('form', { has: page.locator('#account-change-current-password') })
        .getByRole('button', { name: /./ })
        .last()
        .click();

      // This device's own session must keep working — no redirect to
      // /login, and the page's own data still loads afterward (a still-
      // authenticated request succeeding).
      await expect(page).toHaveURL(/\/portal\/account$/);
      await expect(page.locator('#account-full-name')).toBeEnabled();
    });

    await test.step('sign back in with the new password confirms the server actually rotated it', async () => {
      await context.clearCookies();
      await page.goto('/login');
      await page.getByRole('textbox').first().fill(SEED_ROLE_EMAILS.parent);
      await page.getByLabel(/./).nth(1).fill(newPassword);
      await page.getByRole('button', { name: /./ }).last().click();
      await expect(page).toHaveURL(/\/portal/);
    });
  } finally {
    // Restore the shared seed password — this account is reused by every
    // other spec that logs in as `parent`, so leaving it rotated would
    // break the rest of the suite.
    await test.step('restore the seed password', async () => {
      await page.goto('/login');
      await page.getByRole('textbox').first().fill(SEED_ROLE_EMAILS.parent);
      await page.getByLabel(/./).nth(1).fill(newPassword);
      await page.getByRole('button', { name: /./ }).last().click();
      await page.waitForURL(/\/portal/);
      await page.goto('/portal/account');
      await page.locator('#account-change-current-password').fill(newPassword);
      await page.locator('#account-change-new-password').fill(password);
      await page.locator('#account-change-confirm-password').fill(password);
      await page
        .locator('form', { has: page.locator('#account-change-current-password') })
        .getByRole('button', { name: /./ })
        .last()
        .click();
      await expect(page.locator('#account-full-name')).toBeEnabled();
    });
  }
});
