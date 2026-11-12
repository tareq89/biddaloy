import { http, HttpResponse } from 'msw';

import type { PlatformApproval } from '../../../hooks/platform-approvals';
import type { PlatformOwner } from '../../../hooks/platform-owners';

/** Cockpit (platform owner) endpoints: sign-in, owners, approvals, settings, step-up. Shapes follow
 * `server/src/modules/{auth/cockpit,platform-identity}`. A test swaps in an error with
 * `server.use(errorHandler(...))`, or `cockpitHandlers.approvalRequested` for the two-owner case. */
export const platformOwnerFixture = (overrides: Partial<PlatformOwner> = {}): PlatformOwner => ({
  userId: '11111111-1111-4111-8111-111111111111',
  fullName: 'Owner One',
  email: 'owner1@example.test',
  phone: null,
  status: 'ACTIVE',
  lockedAt: null,
  lockedByName: null,
  lastLoginAt: null,
  mfaEnrolled: true,
  ...overrides,
});

export const platformApprovalFixture = (
  overrides: Partial<PlatformApproval> = {},
): PlatformApproval => ({
  id: '22222222-2222-4222-8222-222222222222',
  scope: 'platform.owner_lock',
  summary: { action: 'Lock an owner' },
  status: 'PENDING',
  requested_by: '11111111-1111-4111-8111-111111111111',
  decided_by: null,
  decided_at: null,
  expires_at: '2030-01-01T00:00:00.000Z',
  created_at: '2029-12-31T00:00:00.000Z',
  ...overrides,
});

export const cockpitHandlers = {
  approvalRequested: (method: 'post' | 'patch', path: string, requestId = 'req-1') =>
    http[method](path, () =>
      HttpResponse.json(
        {
          statusCode: 403,
          message: 'Forbidden',
          timestamp: '',
          path,
          requestId: 'r',
          details: { code: 'APPROVAL_REQUESTED', requestId },
        },
        { status: 403 },
      ),
    ),
};

export const cockpitDefaultHandlers = [
  http.post('*/auth/cockpit/login', () =>
    HttpResponse.json({ step: 'mfa', mfaToken: 'mfa-token' }),
  ),
  http.post('*/auth/cockpit/mfa', () =>
    HttpResponse.json({ step: 'done', access_token: 'cockpit-token' }),
  ),
  http.post('*/auth/cockpit/device-otp', () =>
    HttpResponse.json({ step: 'done', access_token: 'cockpit-token' }),
  ),
  http.post('*/auth/cockpit/enrol/start', () =>
    HttpResponse.json({
      otpauthUri: 'otpauth://totp/x?secret=JBSWY3DPEHPK3PXP',
      secret: 'JBSWY3DPEHPK3PXP',
    }),
  ),
  http.post('*/auth/cockpit/enrol/confirm', () =>
    HttpResponse.json({
      step: 'done',
      access_token: 'cockpit-token',
      recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'],
    }),
  ),
  http.post('*/auth/cockpit/forgot-password', () => new HttpResponse(null, { status: 202 })),
  http.post('*/auth/cockpit/reset-password', () => new HttpResponse(null, { status: 204 })),
  http.get('*/auth/cockpit/mfa-status', () =>
    HttpResponse.json({ enrolled: true, recoveryRemaining: 8 }),
  ),
  http.post('*/auth/cockpit/recovery-codes', () =>
    HttpResponse.json({ recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'] }),
  ),
  http.get('*/auth/cockpit/sessions', () =>
    HttpResponse.json({
      data: [
        {
          id: 's1',
          started_at: '2029-12-31T00:00:00.000Z',
          last_used_at: '2029-12-31T01:00:00.000Z',
          user_agent: 'Test',
          ip_address: '127.0.0.1',
          current: true,
        },
      ],
    }),
  ),
  http.delete('*/auth/cockpit/sessions/:id', () => new HttpResponse(null, { status: 204 })),
  http.post('*/platform/step-up', () =>
    HttpResponse.json({ approval_token: 'owner-token', expires_at: '2030-01-01T00:00:00.000Z' }),
  ),
  http.get('*/platform/owners/history', () =>
    HttpResponse.json({
      data: [
        {
          id: 'h1',
          action: 'PLATFORM_OWNER_LOCKED',
          actorName: 'Owner One',
          at: '2029-12-31T00:00:00.000Z',
          label: 'Owner One locked Owner Two',
        },
      ],
      nextCursor: null,
    }),
  ),
  http.get('*/platform/owners', () =>
    HttpResponse.json([
      platformOwnerFixture(),
      platformOwnerFixture({
        userId: '33333333-3333-4333-8333-333333333333',
        fullName: 'Owner Two',
      }),
    ]),
  ),
  http.post('*/platform/owners/:userId/lock', () => new HttpResponse(null, { status: 204 })),
  http.post('*/platform/owners/:userId/unlock', () => new HttpResponse(null, { status: 204 })),
  http.get('*/platform/approvals', () => HttpResponse.json([platformApprovalFixture()])),
  http.post('*/platform/approvals/:id/approve', () => new HttpResponse(null, { status: 204 })),
  http.post('*/platform/approvals/:id/deny', () => new HttpResponse(null, { status: 204 })),
  http.get('*/platform/settings/approvals', () => HttpResponse.json({ enabled: true })),
  http.patch('*/platform/settings/approvals', async ({ request }) =>
    HttpResponse.json(await request.json()),
  ),
];
