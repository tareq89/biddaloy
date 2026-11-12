import '@biddaloy/ui/test';

import { configureSessionEndpoints, getAccessToken, setAccessToken } from '@biddaloy/ui/api';
import { toast } from '@biddaloy/ui/components';
import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}));

import { DevicesSection, RecoveryCodesSection, TwoStepCard } from './security-cards';

const COCKPIT_ENDPOINTS = {
  refresh: '/auth/cockpit/refresh',
  logout: '/auth/cockpit/logout',
  logoutAll: '/auth/cockpit/logout-all',
};

beforeEach(() => configureSessionEndpoints(COCKPIT_ENDPOINTS));

afterEach(async () => {
  configureSessionEndpoints({
    refresh: '/auth/refresh',
    logout: '/auth/logout',
    logoutAll: '/auth/logout-all',
  });
  await cleanupTestState();
});

const SESSIONS = [
  {
    id: 's1',
    started_at: '2026-11-10T10:00:00Z',
    last_used_at: '2026-11-10T10:00:00Z',
    user_agent: null,
    ip_address: null,
    current: true,
  },
  {
    id: 's2',
    started_at: '2026-11-09T10:00:00Z',
    last_used_at: '2026-11-09T10:00:00Z',
    user_agent: null,
    ip_address: null,
    current: false,
  },
];

describe('RecoveryCodesSection', () => {
  it('asks to confirm, then for a code, then shows the new codes', async () => {
    const tokens: (string | null)[] = [];
    server.use(
      http.post('*/auth/cockpit/recovery-codes', ({ request }) => {
        const token = request.headers.get('X-Approval-Token');
        tokens.push(token);
        return token
          ? HttpResponse.json({ recoveryCodes: ['AAAA-BBBB-CCCC-DDDD'] })
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
    renderWithProviders(
      <ApprovalModalHostProvider>
        <RecoveryCodesSection remaining={4} />
      </ApprovalModalHostProvider>,
      { locale: 'en' },
    );
    expect(await screen.findByText('4 recovery codes left.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Make new codes' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Make new recovery codes?')).toBeTruthy();
    expect(tokens).toHaveLength(0);
    await user.click(within(confirm).getByRole('button', { name: 'Make new codes' }));
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    expect(await screen.findByText('AAAA-BBBB-CCCC-DDDD')).toBeTruthy();
    expect(tokens).toEqual([null, 'owner-token']);
  });
});

describe('RecoveryCodesSection cancel', () => {
  it('dismissing the code prompt shows no error and no codes, and the button works again', async () => {
    server.use(
      http.post('*/auth/cockpit/recovery-codes', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'x',
            timestamp: '',
            path: '/',
            requestId: 'r',
            details: { code: 'APPROVAL_REQUIRED' },
          },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <ApprovalModalHostProvider>
        <RecoveryCodesSection remaining={4} />
      </ApprovalModalHostProvider>,
      { locale: 'en' },
    );
    await user.click(await screen.findByRole('button', { name: 'Make new codes' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.click(within(confirm).getByRole('button', { name: 'Make new codes' }));
    await screen.findByLabelText('Authenticator code');
    await user.keyboard('{Escape}');
    await vi.waitFor(() => expect(screen.queryByLabelText('Authenticator code')).toBeNull());
    expect(screen.queryByText('New codes could not be made. Try again.')).toBeNull();
    expect(screen.queryByText('AAAA-BBBB-CCCC-DDDD')).toBeNull();
    expect(screen.getByRole('button', { name: 'Make new codes' })).toHaveProperty(
      'disabled',
      false,
    );
  });
});

describe('DevicesSection', () => {
  it('sign out everywhere ends the session and leaves', async () => {
    const hit: string[] = [];
    server.use(
      http.get('*/auth/cockpit/sessions', () =>
        HttpResponse.json({
          data: [
            {
              id: 's1',
              started_at: '2026-11-10T10:00:00Z',
              last_used_at: '2026-11-10T10:00:00Z',
              user_agent: null,
              ip_address: null,
              current: true,
            },
            {
              id: 's2',
              started_at: '2026-11-09T10:00:00Z',
              last_used_at: '2026-11-09T10:00:00Z',
              user_agent: null,
              ip_address: null,
              current: false,
            },
          ],
        }),
      ),
      // The school route must never be hit: it would leave the cockpit sessions alive.
      http.post('*/auth/logout-all', () => {
        hit.push('school-logout-all');
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('*/auth/cockpit/logout-all', () => {
        hit.push('cockpit-logout-all');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const left = vi.fn();
    renderWithProviders(<DevicesSection onSignedOutEverywhere={left} />, { locale: 'en' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sign out everywhere' }));
    await vi.waitFor(() => expect(left).toHaveBeenCalled());
    expect(hit).toEqual(['cockpit-logout-all']);
  });

  it('warns when sign out everywhere did not reach the server, and still leaves', async () => {
    const warn = vi.spyOn(toast, 'error').mockImplementation(() => 1);
    server.use(
      http.get('*/auth/cockpit/sessions', () => HttpResponse.json({ data: SESSIONS })),
      http.post('*/auth/cockpit/logout-all', () => HttpResponse.error()),
    );
    setAccessToken('tok');
    const left = vi.fn();
    renderWithProviders(<DevicesSection onSignedOutEverywhere={left} />, { locale: 'en' });
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Sign out everywhere' }));
    await vi.waitFor(() => expect(left).toHaveBeenCalled());
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/may still be signed in/),
      expect.anything(),
    );
    warn.mockRestore();
    expect(getAccessToken()).toBeNull();
  });

  it('signing out the current device runs the full local teardown and leaves', async () => {
    const loggedOut: string[] = [];
    server.use(
      http.get('*/auth/cockpit/sessions', () =>
        HttpResponse.json({
          data: [
            {
              id: 's1',
              started_at: '2026-11-10T10:00:00Z',
              last_used_at: '2026-11-10T10:00:00Z',
              user_agent: null,
              ip_address: null,
              current: true,
            },
            {
              id: 's2',
              started_at: '2026-11-09T10:00:00Z',
              last_used_at: '2026-11-09T10:00:00Z',
              user_agent: null,
              ip_address: null,
              current: false,
            },
          ],
        }),
      ),
      http.delete('*/auth/cockpit/sessions/s1', () => new HttpResponse(null, { status: 204 })),
      http.post('*/auth/cockpit/logout', () => {
        loggedOut.push('logout');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    setAccessToken('tok');
    const left = vi.fn();
    renderWithProviders(<DevicesSection onSignedOutEverywhere={left} />, { locale: 'en' });
    const buttons = await screen.findAllByRole('button', { name: /^sign out(?! everywhere)/i });
    await userEvent.click(buttons[0]!);
    const confirm = screen.queryByRole('alertdialog');
    if (confirm)
      await userEvent.click(within(confirm).getAllByRole('button').at(-1) as HTMLElement);
    await vi.waitFor(() => expect(left).toHaveBeenCalled());
    expect(getAccessToken()).toBeNull();
    // Same teardown as logout: the cockpit logout runs (timer, bootstrap memo and cache cleared).
    expect(loggedOut).toEqual(['logout']);
  });
});

describe('TwoStepCard', () => {
  const link = () => screen.queryByRole('link');

  it('offers set up when off, and no replace action when on', () => {
    const { unmount } = renderWithProviders(
      <TwoStepCard enrolled={false} failed={false} onRetry={vi.fn()} />,
      { locale: 'en' },
    );
    expect(link()?.getAttribute('href')).toBe('/owner-security/two-step');
    unmount();
    renderWithProviders(<TwoStepCard enrolled failed={false} onRetry={vi.fn()} />, {
      locale: 'en',
    });
    expect(link()).toBeNull();
    expect(screen.queryByText('Replace authenticator')).toBeNull();
  });
});
