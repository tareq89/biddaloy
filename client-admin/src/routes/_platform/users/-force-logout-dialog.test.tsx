import '@biddaloy/ui/test';

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ForceLogoutDialog } from './-force-logout-dialog';

const person = { userId: '22222222-2222-4222-8222-222222222201', fullName: 'Anika Rahman' };

const approvalRequired = () =>
  HttpResponse.json(
    {
      statusCode: 403,
      message: 'x',
      timestamp: '2030-01-01T00:00:00.000Z',
      path: '/platform/users/x/logout',
      requestId: 'r',
      details: { code: 'APPROVAL_REQUIRED' },
    },
    { status: 403 },
  );

async function view() {
  await i18n.loadNamespaces(['platformUsers']);
  await i18n.changeLanguage('en');
  const onOpenChange = vi.fn();
  renderWithProviders(
    <ApprovalModalHostProvider>
      <ForceLogoutDialog open onOpenChange={onOpenChange} person={person} />
    </ApprovalModalHostProvider>,
    { locale: 'en' },
  );
  return onOpenChange;
}

afterEach(async () => {
  await cleanupTestState();
});

describe('ForceLogoutDialog', () => {
  it('asks the authenticator code, then signs the person out and closes', async () => {
    let token: string | null = null;
    server.use(
      http.post('*/platform/users/:id/logout', ({ request }) => {
        token = request.headers.get('X-Approval-Token');
        return token ? new HttpResponse(null, { status: 204 }) : approvalRequired();
      }),
      http.post('*/platform/step-up', () => HttpResponse.json({ approval_token: 'tok-1' })),
    );
    const onOpenChange = await view();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    await userEvent.type(await screen.findByLabelText('Authenticator code'), '123456');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(token).toBe('tok-1');
  });

  it('shows a fixed error when the server refuses', async () => {
    server.use(
      http.post('*/platform/users/:id/logout', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    await view();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }));
    expect(await screen.findByText('Could not sign out. Try again.')).toBeTruthy();
  });
});
