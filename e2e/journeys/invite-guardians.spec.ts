import type { APIRequestContext } from '@playwright/test';

import {
  adminApiSession,
  createGuardian,
  createStudentWithGuardian,
  get,
  type ApiSession,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ListShellPage } from '../pages/list-shell';

/**
 * [12.6] Invite at scale — preview-first batch provisioning of guardian
 * accounts. Seeds 3 students behind one shared guardian phone (so there
 * are 2 distinct guardians to invite, not 3), runs the full
 * select → preview → confirm flow from `/guardians`, then checks both
 * the batch actually drains and the new PARENT accounts show up in the
 * `/staff?invitation_status=PENDING` filter.
 *
 * The delivery provider is unconfigured in this environment
 * (`ACCOUNT_ACCESS_ECHO_SECRETS`/no real SMS/email provider), so rows can
 * legitimately end up FAILED rather than SENT — the assertion is on the
 * total row count (`sent + failed === 2`), never on the SENT count alone.
 */

test.use(loggedIn('admin'));

interface InviteBatchStatus {
  batch_id: string;
  total: number;
  sent: number;
  failed: number;
  queued: number;
}

async function pollBatchUntilDrained(
  request: APIRequestContext,
  session: ApiSession,
  batchId: string,
): Promise<InviteBatchStatus> {
  await expect
    .poll(
      async () => {
        const status = await get<InviteBatchStatus>(
          request,
          session,
          `/users/invitations/batch/${batchId}`,
        );
        return status.queued;
      },
      { timeout: 30_000, intervals: [1000] },
    )
    .toBe(0);
  return get<InviteBatchStatus>(request, session, `/users/invitations/batch/${batchId}`);
}

test('invite guardians in bulk from the guardians list', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const suffix = Date.now();
  const sharedPhone = `018${String(suffix).slice(-8)}`;
  const soloPhone = `019${String(suffix).slice(-8)}`;

  const sharedGuardian = await createGuardian(
    request,
    session,
    `Shared Guardian ${suffix}`,
    sharedPhone,
  );
  const soloGuardian = await createGuardian(request, session, `Solo Guardian ${suffix}`, soloPhone);

  // Two students behind the shared guardian, one behind the solo
  // guardian — 3 students, 2 distinct guardians to invite.
  await createStudentWithGuardian(
    request,
    session,
    `Invite Student A ${suffix}`,
    sharedGuardian.id,
  );
  await createStudentWithGuardian(
    request,
    session,
    `Invite Student B ${suffix}`,
    sharedGuardian.id,
  );
  await createStudentWithGuardian(request, session, `Invite Student C ${suffix}`, soloGuardian.id);

  let batchId: string | undefined;

  await test.step('open the invite dialog from /guardians and run the preview', async () => {
    await page.goto('/guardians');
    await page.getByRole('button', { name: t('guardians.invite.trigger') }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: t('guardians.invite.title') })).toBeVisible();

    await dialog.getByRole('button', { name: t('guardians.invite.select.runPreview') }).click();
    // Move from the "select" step to the "preview" review step — the
    // confirm button lives only there.
    await dialog.getByRole('button', { name: 'Next' }).click();

    await expect(
      dialog.getByText(t('guardians.invite.preview.summary', { count: 2, skipped: 0 })),
    ).toBeVisible();
  });

  await test.step('confirm dispatch and poll the batch until it drains', async () => {
    const dialog = page.getByRole('dialog');
    const dispatchResponse = page.waitForResponse(
      (res) => res.url().includes('/users/invitations/batch') && res.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: t('guardians.invite.confirm') }).click();
    const response = await dispatchResponse;
    const body = (await response.json()) as { batch_id: string };
    batchId = body.batch_id;

    const finalStatus = await pollBatchUntilDrained(request, session, batchId);
    expect(finalStatus.sent + finalStatus.failed).toBe(2);
  });

  await test.step('the pending guardians show up on the staff invitation filter', async () => {
    const staff = new ListShellPage(page, { titleKey: 'staff.list.title' });
    await page.goto('/staff?invitation_status=PENDING');
    await staff.expectLoaded();
    await expect(staff.row(`Shared Guardian ${suffix}`).first()).toBeVisible();
    await expect(staff.row(`Solo Guardian ${suffix}`).first()).toBeVisible();
  });
});
