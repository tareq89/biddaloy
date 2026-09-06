import {
  adminApiSession,
  apiSession,
  createInvitedParentUser,
  createStudentWithDues,
} from '../api';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import { ActivatePage } from '../pages/activate-page';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from '../seed-contract';
import { t } from '../i18n';

/**
 * [8.14.4] `/portal/account` — the first screen anywhere to consume
 * `PATCH /users/me`, `GET`/`PATCH /guardians/mine`, and `POST
 * /auth/change-password`.
 *
 * Selectors here are mostly the stable HTML `id`s each form field carries
 * (`ui/src/components/*-form.tsx`) rather than translated label text —
 * the suite's default locale is `bn`, so a hardcoded English string would
 * be locale-fragile.
 *
 * Where a label *is* the only stable handle (the [12.7] contact-change
 * dialog below has no field ids), go through `t()` — `e2e/i18n.ts` does
 * register the `portal` namespace, and its keys are FULLY QUALIFIED there
 * (`t('portal.account.contact.change')`), unlike inside the component,
 * where `useTranslation('portal')` has already bound the namespace.
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

/**
 * [12.7] The commit-on-verify contact-change flow, driven from
 * `/portal/account`'s new "Change" button next to the phone row. Uses a
 * freshly created + activated parent (like `password-recovery.spec.ts`'s
 * guardian-recovery journey) rather than a seeded account — no shared
 * fixture to restore, so no `try/finally` dance is needed here.
 *
 * The OTP comes from the `/users/me/contact-change` response's
 * `debug.otp` (`ACCOUNT_ACCESS_ECHO_SECRETS=true` in this environment),
 * same interception pattern as the password-recovery journey above.
 */
test.describe('contact change', () => {
  test.use(guest);

  test('a wrong code leaves the old phone in place; the right one replaces and verifies it', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const guardian = await createInvitedParentUser(request, admin, 'Contact Change E2E');
    const password = 'an-original-password';
    const newPhone = `017${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

    const activate = new ActivatePage(page);

    await test.step('activate the account, landing signed in on the portal', async () => {
      await activate.goto(guardian.token);
      await activate.setPassword(password);
      await expect(page).toHaveURL(/\/portal/);
    });

    await test.step('navigate to /portal/account and open "Change" on the phone row', async () => {
      await page.goto('/portal/account');
      const phoneRow = page.locator('div', { hasText: guardian.phone });
      await phoneRow.getByRole('button', { name: t('portal.account.contact.change') }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
    });

    let otp: string | undefined;

    await test.step('request the change and read the OTP from the debug echo', async () => {
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/api/v1/users/me/contact-change')),
        (async () => {
          await page.getByLabel(t('portal.account.contact.newPhoneLabel')).fill(newPhone);
          await page.getByLabel(t('portal.account.contact.currentPasswordLabel')).fill(password);
          await page.getByRole('button', { name: t('portal.account.contact.continue') }).click();
        })(),
      ]);
      const body = (await response.json()) as { debug?: { otp?: string } };
      otp = body.debug?.otp;
      if (!otp) {
        throw new Error(
          'No debug.otp in the contact-change response — is ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
        );
      }
    });

    await test.step('a wrong code is rejected and the old phone is still shown', async () => {
      const wrongOtp = otp === '000000' ? '111111' : '000000';
      await page.getByLabel(t('portal.account.contact.otpStep.label')).fill(wrongOtp);
      await page.getByRole('button', { name: t('portal.account.contact.otpStep.confirm') }).click();
      await expect(page.getByText(t('portal.account.contact.errors.invalidCode'))).toBeVisible();

      await page.getByRole('button', { name: t('portal.account.contact.cancel') }).click();
      await expect(page.getByText(guardian.phone)).toBeVisible();
    });

    await test.step('the right code replaces the phone and marks it verified', async () => {
      // A fresh request issues a fresh code — the first one is no longer
      // live, so this re-reads `debug.otp` rather than reusing the one
      // from the wrong-code step above.
      const phoneRow = page.locator('div', { hasText: guardian.phone });
      await phoneRow.getByRole('button', { name: t('portal.account.contact.change') }).click();
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/api/v1/users/me/contact-change')),
        (async () => {
          await page.getByLabel(t('portal.account.contact.newPhoneLabel')).fill(newPhone);
          await page.getByLabel(t('portal.account.contact.currentPasswordLabel')).fill(password);
          await page.getByRole('button', { name: t('portal.account.contact.continue') }).click();
        })(),
      ]);
      const body = (await response.json()) as { debug?: { otp?: string } };
      const freshOtp = body.debug?.otp;
      if (!freshOtp) {
        throw new Error('No debug.otp in the second contact-change response.');
      }

      await page.getByLabel(t('portal.account.contact.otpStep.label')).fill(freshOtp);
      await page.getByRole('button', { name: t('portal.account.contact.otpStep.confirm') }).click();

      const newPhoneRow = page.locator('div', { hasText: newPhone });
      // The label interpolates a locale-formatted date, so match the stem
      // ahead of `{{date}}` rather than a string that depends on today.
      const verifiedStem = t('portal.account.contact.verified').replace('{{date}}', '').trim();
      await expect(newPhoneRow.getByText(verifiedStem, { exact: false })).toBeVisible();
      await expect(page.getByText(guardian.phone)).not.toBeVisible();
    });
  });
});
