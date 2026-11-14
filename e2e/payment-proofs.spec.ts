import { type APIRequestContext } from '@playwright/test';

import {
  adminApiSession,
  createGuardian,
  createStudentWithDues,
  get,
  loginAsFreshUser,
  patch,
  post,
  type ApiSession,
} from './api';
import { shells } from './config';
import { expect, guest, test } from './fixtures/test';
import { t } from './i18n';
import { LoginPage } from './pages/login-page';
import { SEED_PASSWORD_ENV, SEED_ROLE_EMAILS } from './seed-contract';

/**
 * [Epic 3 / #3978] Wave 4 close journey (locale bn): a guardian sends a payment proof with a
 * photo, the accountant confirms it, and the guardian sees CONFIRMED while the invoice says how it
 * was paid. A second proof is rejected with a reason and the guardian sees why.
 *
 * Own guardian, own two children, own bills: nothing here touches the shared seeded family.
 * The school-wide proof switch is turned on for the run and put back after.
 */

interface InviteBatchStatus {
  queued: number;
}

/** Smallest body the server's file-signature check accepts as a JPEG. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

interface Submitted {
  id: string;
}

async function setProofSwitch(
  request: APIRequestContext,
  session: ApiSession,
  payments: { proofEnabled: boolean; proofMethods: { method: string; instructions: string }[] },
): Promise<void> {
  await patch(request, session, `/schools/${session.tenantId}/settings`, { payments });
}

test.describe('payment proofs: guardian sends -> accountant decides -> guardian sees', () => {
  test.use(guest);

  test('confirm path and reject path on children of their own', async ({
    browser,
    playwright,
    request,
  }) => {
    test.setTimeout(240_000);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const phone = `018${suffix.slice(-8)}`;
    const childA = `Proof Child A ${suffix}`;
    const childB = `Proof Child B ${suffix}`;
    const trxId = `E2E${suffix.slice(-8)}`;
    const admin = await adminApiSession(request);

    const before = await get<{ payments?: { proofEnabled?: boolean; proofMethods?: never[] } }>(
      request,
      admin,
      `/schools/${admin.tenantId}/settings`,
    );
    await setProofSwitch(request, admin, {
      proofEnabled: true,
      proofMethods: [{ method: 'BKASH', instructions: 'Send to 01700000000' }],
    });

    const guardian = await createGuardian(request, admin, `Proof Guardian ${suffix}`, phone);
    const a = await createStudentWithDues(request, admin, childA, { guardianId: guardian.id });
    const b = await createStudentWithDues(request, admin, childB, { guardianId: guardian.id });
    const batch = await post<{ batch_id: string }>(request, admin, '/users/invitations/batch', {
      guardian_ids: [guardian.id],
    });
    await expect
      .poll(
        async () =>
          (
            await get<InviteBatchStatus>(
              request,
              admin,
              `/users/invitations/batch/${batch.batch_id}`,
            )
          ).queued,
        { timeout: 30_000, intervals: [500, 1000] },
      )
      .toBe(0);

    const accountantApi = await playwright.request.newContext({ baseURL: shells.app.baseURL });
    const password = process.env[SEED_PASSWORD_ENV];
    if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
    const accountantContext = await browser.newContext({
      storageState: await loginAsFreshUser(
        accountantApi,
        shells.app.baseURL,
        SEED_ROLE_EMAILS.accountant,
        password,
      ),
    });
    const guardianContext = await browser.newContext();
    const paidOn = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

    try {
      const guardianPage = await guardianContext.newPage();
      await test.step('guardian signs in for the first time', async () => {
        const login = new LoginPage(guardianPage);
        await login.goto();
        await guardianPage.getByRole('link', { name: t('auth.login.firstTime') }).click();
        await login.requestAndEnterOtp(phone);
        await guardianPage.getByRole('button', { name: t('auth.setPassword.skip') }).click();
        await expect(guardianPage).toHaveURL(/\/portal/);
      });

      /** Opens the Pay page with only `child` ticked, sends a proof, returns its id. */
      async function sendProof(child: string, other: string, withTrx: boolean): Promise<Submitted> {
        await guardianPage.goto('/portal/fees/pay');
        await expect(
          guardianPage.getByRole('heading', { name: t('portalPay.bills.title') }),
        ).toBeVisible();
        // Bills of every child start ticked; untick the other child's group.
        await guardianPage.getByRole('group', { name: other }).getByRole('checkbox').click();
        await expect(
          guardianPage.getByRole('group', { name: child }).getByRole('checkbox'),
        ).toBeChecked();
        await guardianPage.getByLabel(t('portalPay.proof.paidOn')).fill(paidOn);
        if (withTrx) {
          await guardianPage.getByLabel(t('portalPay.proof.trxId')).fill(trxId);
        }
        await guardianPage
          .getByLabel(t('portalPay.proof.filesLabel'))
          .setInputFiles({ name: 'proof.jpg', mimeType: 'image/jpeg', buffer: JPEG });
        const sent = guardianPage.waitForResponse(
          (r) =>
            r.url().endsWith('/portal/payment-proofs') && r.request().method() === 'POST' && r.ok(),
        );
        await guardianPage.getByRole('button', { name: t('portalPay.proof.submit') }).click();
        const body = (await (await sent).json()) as Submitted;
        await expect(
          guardianPage.getByRole('heading', { name: t('portalPay.done.title') }),
        ).toBeVisible();
        return body;
      }

      const proofA = await test.step('guardian sends a proof for child A with a photo', () =>
        sendProof(childA, childB, true));
      const proofB = await test.step('guardian sends a proof for child B', () =>
        sendProof(childB, childA, true));

      const accountantPage = await accountantContext.newPage();
      await test.step('accountant confirms proof A with "Confirm & next"', async () => {
        await accountantPage.goto(`/payments/online/${proofA.id}`);
        const confirm = accountantPage.getByRole('button', {
          name: t('onlinePayments.review.actions.confirmLast'),
        });
        await expect(confirm.first()).toBeFocused();
        const done = accountantPage.waitForResponse(
          (r) => r.url().includes(`/payment-submissions/${proofA.id}/confirm`) && r.ok(),
        );
        await confirm.first().click();
        expect(((await (await done).json()) as { outcome: string }).outcome).toBe('SETTLED');
      });

      await test.step('accountant rejects proof B with a reason', async () => {
        await accountantPage.goto(`/payments/online/${proofB.id}`);
        await accountantPage
          .getByRole('button', { name: t('onlinePayments.review.actions.reject') })
          .click();
        const dialog = accountantPage.getByRole('dialog');
        await dialog
          .getByRole('combobox', { name: t('onlinePayments.reject.reasonLabel') })
          .click();
        await accountantPage
          .getByRole('option', { name: t('onlinePayments.reject.reasons.IMAGE_UNCLEAR') })
          .click();
        const done = accountantPage.waitForResponse(
          (r) => r.url().includes(`/payment-submissions/${proofB.id}/reject`) && r.ok(),
        );
        await dialog.getByRole('button', { name: t('onlinePayments.reject.submit') }).click();
        await done;
      });

      await test.step('guardian sees CONFIRMED for A and REJECTED with the reason for B', async () => {
        await guardianPage.goto('/portal/fees');
        await guardianPage.getByRole('tab', { name: t('portal.proofs.tabProofs') }).click();
        const cardOf = (name: string) =>
          guardianPage
            .getByTestId('proof-card')
            .filter({ has: guardianPage.getByRole('heading', { name }) });
        await expect(cardOf(childA).getByText(t('portal.proofs.status.CONFIRMED'))).toBeVisible();
        await expect(cardOf(childB).getByText(t('portal.proofs.status.REJECTED'))).toBeVisible();
        await expect(
          cardOf(childB).getByText(t('portal.proofs.rejectReason.IMAGE_UNCLEAR')),
        ).toBeVisible();
      });

      await test.step('the invoice for A says how it was paid', async () => {
        const list = await get<{ data: { id: string }[] }>(
          request,
          admin,
          `/invoices?student_id=${a.studentId}`,
        );
        const invoiceId = list.data[0]?.id;
        expect(invoiceId, 'a confirmed proof makes an invoice').toBeTruthy();
        const print = await request.get(`/api/v1/invoices/${invoiceId}/print`, {
          headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId ?? '' },
        });
        expect(print.ok()).toBe(true);
        const html = await print.text();
        expect(html).toContain('How it was paid');
        expect(html).toContain(trxId);
        // B was rejected: nothing was paid, so it has no invoice.
        const none = await get<{ data: unknown[] }>(
          request,
          admin,
          `/invoices?student_id=${b.studentId}`,
        );
        expect(none.data).toHaveLength(0);
      });
    } finally {
      await guardianContext.close();
      await accountantContext.close();
      await accountantApi.dispose();
      await setProofSwitch(request, admin, {
        proofEnabled: before.payments?.proofEnabled ?? false,
        proofMethods: [],
      });
    }
  });
});
