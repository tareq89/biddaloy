import '@biddaloy/ui/test';

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/platformOwners.json';
import en from '../../../../../ui/src/i18n/locales/en/platformOwners.json';

import { OwnersTab } from './owners-tab';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const owner = (userId: string, fullName: string, status: 'ACTIVE' | 'LOCKED' = 'ACTIVE') => ({
  userId,
  fullName,
  email: 'o***@example.test',
  phone: '017*****89',
  status,
  lockedAt: null,
  lockedByName: null,
  lastLoginAt: null,
  mfaEnrolled: true,
});
const serveOwners = (...list: ReturnType<typeof owner>[]) =>
  server.use(http.get('*/platform/owners', () => HttpResponse.json(list)));

const view = (onOpenApprovals = vi.fn()) =>
  renderWithProviders(
    <ApprovalModalHostProvider>
      <OwnersTab currentUserId={ME} onOpenApprovals={onOpenApprovals} />
    </ApprovalModalHostProvider>,
    { locale: 'en' },
  );

afterEach(async () => {
  await cleanupTestState();
});

describe('OwnersTab', () => {
  it('disables Lock on your own card and says why', async () => {
    serveOwners(owner(ME, 'Owner One'), owner(OTHER, 'Owner Two'));
    view();
    const card = await screen.findByRole('group', { name: 'Owner One' });
    expect(within(card).getByRole('button', { name: 'Lock' })).toHaveProperty('disabled', true);
    expect(within(card).getByText('You cannot lock yourself.')).toBeTruthy();
    const other = await screen.findByRole('group', { name: 'Owner Two' });
    expect(within(other).getByRole('button', { name: 'Lock' })).toHaveProperty('disabled', false);
  });

  it('disables Lock for the last active owner', async () => {
    serveOwners(
      owner(OTHER, 'Owner Two'),
      owner('44444444-4444-4444-8444-444444444444', 'Owner Three', 'LOCKED'),
    );
    view();
    await screen.findByText('This is the last active owner, so it cannot be locked.');
    expect(screen.getByRole('button', { name: 'Lock' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Unlock' })).toHaveProperty('disabled', false);
  });

  it('lock: confirm says what is lost, then asks for a code, then locks', async () => {
    serveOwners(owner(ME, 'Owner One'), owner(OTHER, 'Owner Two'));
    const tokens: (string | null)[] = [];
    server.use(
      http.post(`*/platform/owners/${OTHER}/lock`, ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        tokens.push(token);
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
      }),
    );
    const user = userEvent.setup();
    view();
    const other = await screen.findByRole('group', { name: 'Owner Two' });
    await user.click(within(other).getByRole('button', { name: 'Lock' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(/sign-ins end at once/)).toBeTruthy();
    await user.click(within(confirm).getByRole('button', { name: 'Lock' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(tokens).toEqual([null, 'owner-token']));
  });

  it('shows the waiting state with a link to the requests when approval is asked of the other owner', async () => {
    serveOwners(owner(ME, 'Owner One'), owner(OTHER, 'Owner Two'));
    server.use(
      http.post(`*/platform/owners/${OTHER}/lock`, () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'x',
            timestamp: '',
            path: '/',
            requestId: 'r',
            details: { code: 'APPROVAL_REQUESTED', requestId: 'req-1' },
          },
          { status: 403 },
        ),
      ),
    );
    const onOpenApprovals = vi.fn();
    const user = userEvent.setup();
    view(onOpenApprovals);
    const other = await screen.findByRole('group', { name: 'Owner Two' });
    await user.click(within(other).getByRole('button', { name: 'Lock' }));
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Lock' }),
    );
    await screen.findByText('Waiting for the other owner to approve this.');
    await user.click(screen.getByRole('button', { name: 'See approval requests' }));
    expect(onOpenApprovals).toHaveBeenCalled();
  });

  it('shows an error state with retry when the list fails', async () => {
    server.use(http.get('*/platform/owners', () => new HttpResponse(null, { status: 500 })));
    view();
    await screen.findByText('Could not load the owners.');
  });
});

describe('platformOwners strings', () => {
  const NEVER =
    /super admin|tenant|\bMFA\b|\b2FA\b|TOTP|\bOTP\b|recovery key|fingerprint|suspend|revoke|step-up|re-auth|maker-checker|\bsession|\btoken|JWT/i;
  const values = (o: unknown): string[] =>
    typeof o === 'string' ? [o] : Object.values(o as object).flatMap(values);

  it('never uses a word the glossary bans (en)', () => {
    expect(values(en).filter((s) => NEVER.test(s))).toEqual([]);
  });

  it('bn has every en key', () => {
    const keys = (o: object, p = ''): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'string' ? [p + k] : keys(v as object, `${p}${k}.`),
      );
    expect(keys(bn).sort()).toEqual(keys(en).sort());
  });
});
