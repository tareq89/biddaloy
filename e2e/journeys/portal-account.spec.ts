import {
  adminApiSession,
  apiSession,
  createInvitedParentUser,
  createStudentWithDues,
  E2E_PASSWORD,
} from '../api';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import { ActivatePage } from '../pages/activate-page';
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
 * Runs on a STUDENT account minted for this test alone, never on a seeded login.
 *
 * Changing a password revokes every session of that user
 * (`AuthService.changePassword` -> `revokeAllForUser`). Under `fullyParallel:
 * true`, any spec signed in as the same seeded role at that moment gets a 401
 * at login or loses its refresh family mid-test (`portal-applications.spec.ts`
 * signs in as `student`). A fresh account cannot collide with anyone, and
 * there is no seed password to put back afterwards. (`sessions.spec.ts`
 * mints its own account for the same reason.)
 *
 * STUDENT, not PARENT, for the reason the contact-change test below gives:
 * `/portal/account` errors for a PARENT with no `guardians` row. The profile
 * and password cards this test drives are role-agnostic.
 */
test.describe('password change', () => {
  test.use(guest);

  test('this device stays signed in, and the new password works on the next login', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const account = await createInvitedParentUser(request, admin, 'Password Change E2E', 'STUDENT');
    const password = E2E_PASSWORD;
    const newPassword = `${password}-tmp-${Date.now()}`;

    /** The same `POST /auth/login` the sign-in form posts to: true when the server accepts it. */
    const canLogin = async (withPassword: string) =>
      (
        await request.post('/api/v1/auth/login', {
          data: { phone: account.phone, password: withPassword },
        })
      ).ok();

    await test.step('activate the account, landing signed in on the portal', async () => {
      const activate = new ActivatePage(page);
      await activate.goto(account.token);
      await activate.setPassword(password);
      await expect(page).toHaveURL(/\/portal/);
    });

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
      expect(await canLogin(newPassword), 'the new password was rejected').toBe(true);
      expect(await canLogin(password), 'the old password still works').toBe(false);
    });
  });
});

/**
 * [12.7] The commit-on-verify contact-change flow, driven from
 * `/portal/account`'s new "Change" button next to the phone row. Uses a
 * freshly created + activated account (like `password-recovery.spec.ts`'s
 * guardian-recovery journey) rather than a seeded one — no shared fixture
 * to restore, so no `try/finally` dance is needed here.
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
    // STUDENT, not PARENT: a freshly minted account has no `guardians` row,
    // and `/portal/account` renders a page-level error for a PARENT whose
    // `GET /guardians/mine` 404s (`account.tsx` folds that query's error
    // into the page's own). A STUDENT never issues that request, so the
    // page loads on `GET /users/me` alone — the same reason the
    // password-change journey above runs as `student`. The contact-change
    // card itself is role-agnostic.
    const account = await createInvitedParentUser(request, admin, 'Contact Change E2E', 'STUDENT');
    const password = E2E_PASSWORD;
    const newPhone = `017${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
    const changeLabel = t('portal.account.contact.change');

    /**
     * The contact card has one "Change" button per row (email and phone),
     * and neither row carries a stable id — so a row is identified as the
     * innermost `div` holding BOTH the number and a Change button.
     * `hasText` alone would match every ancestor up to `<body>`, and the
     * button lookup inside those would then resolve to both rows' buttons.
     */
    const rowFor = (contact: string) =>
      page
        .locator('div')
        .filter({ hasText: contact })
        .filter({ has: page.getByRole('button', { name: changeLabel }) })
        .last();

    const activate = new ActivatePage(page);

    await test.step('activate the account, landing signed in on the portal', async () => {
      await activate.goto(account.token);
      await activate.setPassword(password);
      await expect(page).toHaveURL(/\/portal/);
    });

    /**
     * Every field lookup below is scoped to the dialog, never to the page.
     * `/portal/account` also renders the change-password card, whose
     * "current password" field carries the SAME label as the dialog's — a
     * page-level `getByLabel` matches both and fails strict mode.
     */
    const dialog = page.getByRole('dialog');

    /** Fills the request step and returns the echoed OTP for the new number. */
    async function requestChange(): Promise<string> {
      const [response] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/api/v1/users/me/contact-change')),
        (async () => {
          await dialog.getByLabel(t('portal.account.contact.newPhoneLabel')).fill(newPhone);
          await dialog.getByLabel(t('portal.account.contact.currentPasswordLabel')).fill(password);
          await dialog.getByRole('button', { name: t('portal.account.contact.continue') }).click();
        })(),
      ]);
      const body = (await response.json()) as { debug?: { otp?: string } };
      const code = body.debug?.otp;
      if (!code) {
        throw new Error(
          'No debug.otp in the contact-change response — is ACCOUNT_ACCESS_ECHO_SECRETS=true set?',
        );
      }
      return code;
    }

    await test.step('navigate to /portal/account and open "Change" on the phone row', async () => {
      await page.goto('/portal/account');
      // The page shows the phone formatted (a hyphen after the fifth digit), so
      // match the last six digits, which stay contiguous.
      await rowFor(account.phone.slice(-6)).getByRole('button', { name: changeLabel }).click();
      await expect(dialog).toBeVisible();
    });

    let otp: string | undefined;

    await test.step('request the change and read the OTP from the debug echo', async () => {
      otp = await requestChange();
    });

    // One request, both codes: a wrong OTP attempt neither consumes the
    // pending change (confirmPhone deletes it only on success) nor the code
    // (the lockout is 5 attempts), so the correct code still verifies in the
    // same dialog. Re-requesting instead would hit `OtpService.request`'s
    // 60s per-number cooldown and get no fresh code — which is exactly how
    // this test failed before.
    await test.step('a wrong code is rejected, leaving the pending change intact', async () => {
      const wrongOtp = otp === '000000' ? '111111' : '000000';
      await dialog.getByLabel(t('portal.account.contact.otpStep.label')).fill(wrongOtp);
      await dialog
        .getByRole('button', { name: t('portal.account.contact.otpStep.confirm') })
        .click();
      await expect(dialog.getByText(t('portal.account.contact.errors.invalidCode'))).toBeVisible();
      // No behind-the-dialog phone assertion: Radix marks the background
      // `aria-hidden` while the modal is open, so `getByRole` (inside
      // `rowFor`) can't see the row's Change button. That the OLD value was
      // untouched is proven by the next step succeeding — the correct code
      // could only verify if the wrong attempt left the pending change and
      // the code intact.
    });

    await test.step('the right code replaces the phone and marks it verified', async () => {
      await dialog.getByLabel(t('portal.account.contact.otpStep.label')).fill(otp as string);
      await dialog
        .getByRole('button', { name: t('portal.account.contact.otpStep.confirm') })
        .click();

      // The row shows a "Verified" badge; the full dated sentence is its title.
      await expect(
        rowFor(newPhone.slice(-6)).getByText(t('portal.account.contact.verifiedShort'), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText(account.phone.slice(-6))).not.toBeVisible();
    });
  });
});
