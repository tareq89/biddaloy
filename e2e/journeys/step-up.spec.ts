import { ApprovalScope } from '@biddaloy/shared';

import { adminApiSession, createStudentWithDues, post, requestStepUpOtp } from '../api';
import { SEED_ROLE_EMAILS } from '../seed-contract';
import { expect, loggedIn, test } from '../fixtures/test';

/**
 * [16.2.5] Journey: the `/auth/step-up` approval flow end to end, driven
 * through a real gated route rather than a throwaway one — `POST
 * /payments/:id/reverse` already carries `@RequireApproval
 * (ApprovalScope.PAYMENTS_REVERSE)` (`checkout.controller.ts`), so this
 * reuses it instead of adding test-only surface to the server.
 *
 * Proves, via the HTTP API (the modal's own client-side behaviour is
 * covered by `record-payment-modal.test.tsx` /
 * `-reverse-payment-dialog.test.tsx` component tests, so this journey
 * focuses on the server contract those UI tests mock out):
 *  - No `X-Approval-Token` → 403 `APPROVAL_REQUIRED`.
 *  - The full OTP step-up flow (`POST /auth/step-up/otp/request` then
 *    `POST /auth/step-up`) yields a token that lets the gated route
 *    succeed exactly once.
 *  - The same token replayed a second time is rejected — a step-up token
 *    is single-use (`ApprovalGuard`/`StepUpService`).
 */

test.use(loggedIn('accountant'));

test('a gated route rejects without a token, then accepts a step-up token exactly once', async ({
  request,
}) => {
  // `requestStepUpOtp` waits out `OtpService`'s 60s-per-identifier
  // cooldown in three 20s sleeps before giving up (see its own comment),
  // which alone overruns Playwright's 30s default. CI gets a fresh Redis
  // and never retries; a repeated local run does, and used to fail on the
  // timeout rather than on anything this test is about.
  test.setTimeout(120_000);

  const admin = await adminApiSession(request);
  const name = `StepUp Student ${Date.now()}`;
  const { studentId } = await createStudentWithDues(request, admin, name, { amount: 1000 });

  const firstPayment = await recordFullPayment(request, admin, studentId);

  // 1. No token at all → 403 APPROVAL_REQUIRED.
  const unauthorized = await request.post(`/api/v1/payments/${firstPayment.id}/reverse`, {
    headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
    data: { reason: 'e2e: step-up without a token' },
  });
  expect(unauthorized.status()).toBe(403);
  const unauthorizedBody = (await unauthorized.json()) as { details?: { code?: string } };
  expect(unauthorizedBody.details?.code).toBe('APPROVAL_REQUIRED');

  // 2. Full OTP step-up: request a code for the seeded ADMIN (an eligible
  // approver), then verify it. `ACCOUNT_ACCESS_ECHO_SECRETS=true` (test
  // config) echoes the generated OTP back on the request response — same
  // trick `api.ts`'s invite helpers use for invitation tokens.
  const otp = await requestStepUpOtp(request, admin, SEED_ROLE_EMAILS.admin);

  const verify = await request.post('/api/v1/auth/step-up', {
    headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
    data: {
      identifier: SEED_ROLE_EMAILS.admin,
      method: 'OTP',
      otp,
      scope: ApprovalScope.PAYMENTS_REVERSE,
    },
  });
  expect(verify.ok()).toBeTruthy();
  const { approval_token: token } = (await verify.json()) as { approval_token: string };

  // 3. Gated route succeeds once with the token.
  const reversed = await request.post(`/api/v1/payments/${firstPayment.id}/reverse`, {
    headers: {
      Authorization: `Bearer ${admin.token}`,
      'X-Tenant-ID': admin.tenantId,
      'X-Approval-Token': token,
    },
    data: { reason: 'e2e: step-up flow proof' },
  });
  expect(reversed.ok()).toBeTruthy();

  // 4. The same token used again — on a second, unrelated gated request —
  // is rejected: single-use.
  const secondName = `StepUp Student B ${Date.now()}`;
  const { studentId: secondStudentId } = await createStudentWithDues(request, admin, secondName, {
    amount: 500,
  });
  const secondPayment = await recordFullPayment(request, admin, secondStudentId);
  const replay = await request.post(`/api/v1/payments/${secondPayment.id}/reverse`, {
    headers: {
      Authorization: `Bearer ${admin.token}`,
      'X-Tenant-ID': admin.tenantId,
      'X-Approval-Token': token,
    },
    data: { reason: 'e2e: replayed token must fail' },
  });
  expect(replay.status()).toBe(403);
  // Which 403 matters: `RolesGuard`/`PermissionsGuard` also answer 403 on
  // this route, so a bare status check would pass even if the token were
  // still valid and something else had rejected the call. Asserting the
  // `ApprovalRequiredException` body is what pins the single-use contract.
  const replayBody = (await replay.json()) as { details?: { code?: string } };
  expect(replayBody.details?.code).toBe('APPROVAL_REQUIRED');
});

/** Pays a seeded student's first open bill in full via `POST
 * /payments/checkout`, returning the recorded payment. Mirrors `api.ts`'s
 * own `createInvoice` helper, which is invoice-shaped rather than
 * payment-shaped — this journey needs the payment id to reverse. */
async function recordFullPayment(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
  studentId: string,
): Promise<{ id: string }> {
  const student = await request.get(`/api/v1/students/${studentId}`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
  });
  const { full_name: fullName } = (await student.json()) as { full_name: string };
  const dues = await request.get(`/api/v1/fees/dues?search=${encodeURIComponent(fullName)}`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
  });
  const duesBody = (await dues.json()) as {
    data: { student_id: string; dues: { student_fee_id: string; balance: number }[] }[];
  };
  const due = duesBody.data.find((row) => row.student_id === studentId)?.dues[0];
  if (!due) throw new Error('No open due for student — seeding failed');
  const result = await post<{ payment: { id: string } }>(request, session, '/payments/checkout', {
    idempotency_key: crypto.randomUUID(),
    lines: [{ student_fee_id: due.student_fee_id, amount: due.balance }],
    payment_method: 'CASH',
  });
  return result.payment;
}
