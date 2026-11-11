import '@biddaloy/ui/test';

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApprovalsTab } from './approvals-tab';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const approval = (over: Record<string, unknown> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  scope: 'platform.owner_lock',
  summary: {},
  status: 'PENDING',
  requested_by: OTHER,
  decided_by: null,
  decided_at: null,
  expires_at: '2030-01-01T00:00:00.000Z',
  created_at: new Date().toISOString(),
  ...over,
});
const serve = (list: unknown[]) =>
  server.use(http.get('*/platform/approvals', () => HttpResponse.json(list)));
const view = () =>
  renderWithProviders(
    <ApprovalModalHostProvider>
      <ApprovalsTab currentUserId={ME} />
    </ApprovalModalHostProvider>,
    { locale: 'en' },
  );
const needsCode =
  (calls: (string | null)[]) =>
  ({ request }: { request: Request }) => {
    const token = request.headers.get('X-Approval-Token');
    calls.push(token);
    return token
      ? new HttpResponse(null, { status: 204 })
      : HttpResponse.json(
          {
            statusCode: 403,
            message: 'x',
            timestamp: '',
            path: '/',
            requestId: 'r',
            details: { code: 'APPROVAL_REQUIRED' },
          },
          { status: 403 },
        );
  };

afterEach(async () => {
  await cleanupTestState();
});

describe('ApprovalsTab', () => {
  it("the other owner's request: Approve asks for a code, then approves", async () => {
    serve([approval()]);
    const calls: (string | null)[] = [];
    server.use(http.post('*/platform/approvals/:id/approve', needsCode(calls)));
    const user = userEvent.setup();
    view();
    await screen.findByText('Lock an owner');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(calls).toEqual([null, 'owner-token']));
  });

  it('Deny asks for a code too', async () => {
    serve([approval()]);
    const calls: (string | null)[] = [];
    server.use(http.post('*/platform/approvals/:id/deny', needsCode(calls)));
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('button', { name: 'Deny' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(calls).toEqual([null, 'owner-token']));
  });

  it('your own pending request shows the waiting state, no buttons', async () => {
    serve([approval({ requested_by: ME })]);
    server.use(
      http.get('*/platform/owners', () =>
        HttpResponse.json([
          {
            userId: ME,
            fullName: 'Owner One',
            email: null,
            phone: null,
            status: 'ACTIVE',
            lockedAt: null,
            lockedByName: null,
            lastLoginAt: null,
            mfaEnrolled: true,
          },
          {
            userId: OTHER,
            fullName: 'Owner Two',
            email: null,
            phone: null,
            status: 'ACTIVE',
            lockedAt: null,
            lockedByName: null,
            lastLoginAt: null,
            mfaEnrolled: true,
          },
        ]),
      ),
    );
    view();
    await screen.findByText('Waiting for Owner Two');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deny' })).toBeNull();
  });

  it('only the row being answered disables its buttons', async () => {
    serve([approval(), approval({ id: '55555555-5555-4555-8555-555555555555' })]);
    server.use(http.post('*/platform/approvals/:id/approve', needsCode([])));
    const user = userEvent.setup();
    view();
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(2));
    await user.click(screen.getAllByRole('button', { name: 'Approve' })[0]!);
    await screen.findByLabelText('Authenticator code');
    const approves = screen.getAllByRole('button', { name: 'Approve', hidden: true });
    expect(approves[0]).toHaveProperty('disabled', true);
    expect(approves[1]).toHaveProperty('disabled', false);
  });

  it('empty state says no request is waiting', async () => {
    serve([]);
    view();
    await screen.findByText('No request is waiting.');
  });

  it('error state offers a retry', async () => {
    server.use(http.get('*/platform/approvals', () => new HttpResponse(null, { status: 500 })));
    view();
    await screen.findByText('Could not load the requests.');
  });

  it('turning approvals off asks first, and shows waiting when the other owner must agree', async () => {
    serve([approval({ requested_by: ME })]);
    server.use(
      http.patch('*/platform/settings/approvals', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'x',
            timestamp: '',
            path: '/',
            requestId: 'r',
            details: { code: 'APPROVAL_REQUESTED', requestId: 'req-9' },
          },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('switch', { name: 'Ask the other owner first' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(await screen.findByRole('button', { name: 'Ask to turn off' }));
    expect(dialog).toBeDefined();
    await screen.findByText('Waiting for the other owner to agree to turn this off.');
  });

  it('turning approvals off again after the other owner approved carries that grant', async () => {
    serve([approval({ requested_by: ME, scope: 'platform.approvals_switch', status: 'GRANTED' })]);
    let sent: string | null = 'not called';
    server.use(
      http.patch('*/platform/settings/approvals', ({ request }) => {
        sent = request.headers.get('X-Platform-Approval');
        return HttpResponse.json({ enabled: false });
      }),
    );
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('switch', { name: 'Ask the other owner first' }));
    await user.click(await screen.findByRole('button', { name: 'Ask to turn off' }));
    await waitFor(() => expect(sent).toBe('22222222-2222-4222-8222-222222222222'));
  });
});
