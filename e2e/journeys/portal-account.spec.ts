import { adminApiSession, apiSession, createStudentWithDues } from '../api';
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

interface GuardianSummary {
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

  // The preview endpoint needs a student that has BOTH open dues (it 400s
  // with "has no open dues to remind about" otherwise) and a linked
  // guardian (it dials that guardian's number). Neither is safe to assume
  // of whatever `/students/mine` happens to return first: the seeded
  // parent's student shares a database with `journeys/fee-collection`,
  // which records payments against seeded dues in parallel, so its dues
  // are only sometimes still open. Create the student instead, linked to
  // the very guardian record `/portal/account` edits below.
  const parentSession = await apiSession(request, 'parent');
  const guardianResponse = await request.get('/api/v1/guardians/mine', {
    headers: {
      Authorization: `Bearer ${parentSession.token}`,
      'X-Tenant-ID': parentSession.tenantId,
    },
  });
  expect(guardianResponse.ok()).toBe(true);
  const { id: guardianId } = (await guardianResponse.json()) as GuardianSummary;

  const adminSession = await adminApiSession(request);
  const { studentId } = await createStudentWithDues(
    request,
    adminSession,
    `Portal Account ${Date.now()}`,
    { guardianId },
  );

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

/**
 * Runs as STUDENT, not PARENT, and that is the whole point.
 *
 * This test has to rotate a seeded account's password, and `fullyParallel:
 * true` means any spec that logs in as the same role can land mid-rotation
 * and get a legitimate 401 for a credential that is correct again moments
 * later. `parent` is the busiest portal account in the suite
 * (`permissions`, `staff-mobile-nav`, `target-size`, and the phone AC test
 * above all sign in as it), so rotating *that* password poisons them all —
 * and if this test fails before its restore runs, it poisons them for the
 * rest of the shard.
 *
 * `student` is the one seeded role no other spec authenticates as (the
 * `setup` project captures its storageState once, before any test runs),
 * so its password is this test's to move. `/portal/account` serves STUDENT
 * fully: `account.tsx` gates only the guardian card behind `isParent`, and
 * the profile and password cards this test drives are role-agnostic.
 */
test.describe('password change', () => {
  test.use(loggedIn('student'));

  test('this device stays signed in, and the new password works on the next login', async ({
    page,
    request,
  }) => {
    const password = process.env[SEED_PASSWORD_ENV];
    if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
    const newPassword = `${password}-tmp-${Date.now()}`;

    /**
     * Verification and restore both go over the API rather than through two
     * more full UI sign-ins (SPA boot, form fill, route transition): the
     * same `POST /auth/login` the form posts to proves the server rotated
     * the credential, and keeps the window in which the seeded password is
     * wrong down to about a second.
     *
     * Returns `null` when the credential is not (or no longer) valid, so
     * the restore below can tell "nothing to restore" from "restore
     * failed".
     */
    async function apiLogin(withPassword: string) {
      const response = await request.post('/api/v1/auth/login', {
        data: { email: SEED_ROLE_EMAILS.student, password: withPassword },
      });
      if (!response.ok()) return null;
      const body = (await response.json()) as {
        access_token: string;
        memberships: { tenantId: string; role: string }[];
      };
      const membership = body.memberships.find((m) => m.role === 'STUDENT');
      return membership ? { token: body.access_token, tenantId: membership.tenantId } : null;
    }

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

        // The success toast, asserted FIRST and by its own text. Without
        // it this step passes whenever the server rejects the change — a
        // 403 "that password is not correct" only paints an inline field
        // error, leaving the URL and the profile card exactly as the two
        // assertions below find them. The failure then surfaced a step
        // later as "the new password was rejected", which reads like a
        // server bug rather than "the form never saved".
        await expect(page.getByText(t('portal.account.password.saved'))).toBeVisible();

        // This device's own session must keep working — no redirect to
        // /login, and the page's own data still loads afterward (a still-
        // authenticated request succeeding).
        await expect(page).toHaveURL(/\/portal\/account$/);
        await expect(page.locator('#account-full-name')).toBeEnabled();
      });

      await test.step('a fresh login with the new password confirms the server rotated it', async () => {
        expect(await apiLogin(newPassword), 'the new password was rejected').not.toBeNull();
        expect(await apiLogin(password), 'the old password still works').toBeNull();
      });
    } finally {
      // Put the seed password back. Nothing else in the suite signs in as
      // `student`, so this is hygiene rather than a race to win — but a
      // silent failure here would still strand the account for the rest of
      // the shard, so every outcome is either restored or reported.
      await test.step('restore the seed password', async () => {
        const session = await apiLogin(newPassword);
        if (!session) {
          // Nothing to put back only if the seed password still works,
          // i.e. the change step never landed. Any other state means the
          // account is stranded on a password nobody knows, which must not
          // pass quietly even though the step above already failed.
          expect(
            await apiLogin(password),
            'the student seed account is stranded: neither the seed nor the new password works',
          ).not.toBeNull();
          return;
        }
        const response = await request.post('/api/v1/auth/change-password', {
          headers: {
            Authorization: `Bearer ${session.token}`,
            'X-Tenant-ID': session.tenantId,
          },
          data: { current_password: newPassword, new_password: password },
        });
        expect(
          response.ok(),
          `restoring the seed password failed (${response.status()}): ${await response.text()}`,
        ).toBe(true);
      });
    }
  });
});
