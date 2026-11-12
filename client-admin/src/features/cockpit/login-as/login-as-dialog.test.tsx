import '@biddaloy/ui/test';

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoginAsDialog } from './login-as-dialog';

const ANIKA = '22222222-2222-4222-8222-222222222201';
const person = (userId: string | null, name: string, unavailableReason: string | null = null) => ({
  userId,
  name,
  role: 'ADMIN',
  email: `${name.split(' ')[0]!.toLowerCase()}@example.test`,
  phone: null,
  unavailableReason,
});

function serveCandidates(
  over: Partial<{
    candidates: ReturnType<typeof person>[];
    noActiveAdmin: boolean;
    supportAccessMode: string;
  }> = {},
) {
  server.use(
    http.get('*/platform/schools/:id/login-as/candidates', () =>
      HttpResponse.json({
        candidates: [person(null, 'Rafi Hasan', 'NO_LOGIN_ACCOUNT'), person(ANIKA, 'Anika Rahman')],
        noActiveAdmin: false,
        schoolStatus: 'ACTIVE',
        supportAccessMode: 'allowed',
        ...over,
      }),
    ),
  );
}

/** Captures the POST body and the headers it was sent with. */
function serveStart(respond: () => Response = () => HttpResponse.json(started())) {
  const calls: { body: Record<string, unknown>; approval: string | null }[] = [];
  server.use(
    http.post('*/platform/impersonation', async ({ request }) => {
      calls.push({
        body: (await request.json()) as Record<string, unknown>,
        approval: request.headers.get('X-Approval-Token'),
      });
      return respond();
    }),
  );
  return calls;
}
const started = () => ({
  id: '33333333-3333-4333-8333-333333333301',
  status: 'ACTIVE',
  code: 'secret-code-123',
  expiresAt: '2030-01-01T00:00:00.000Z',
});

const fakeTab = () => ({ opener: 'x', close: vi.fn(), location: { href: '' } });

function view(props: Partial<React.ComponentProps<typeof LoginAsDialog>> = {}) {
  const onOpenChange = vi.fn();
  const onInviteAdmin = vi.fn();
  renderWithProviders(
    <ApprovalModalHostProvider>
      <LoginAsDialog
        open
        onOpenChange={onOpenChange}
        schoolId="11111111-1111-4111-8111-111111111111"
        schoolName="Rose Valley"
        onInviteAdmin={onInviteAdmin}
        {...props}
      />
    </ApprovalModalHostProvider>,
    { locale: 'en' },
  );
  return { onOpenChange, onInviteAdmin };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTestState();
});

describe('LoginAsDialog', () => {
  it('defaults to Admin and the first person who can be chosen', async () => {
    serveCandidates();
    view();
    const rows = await screen.findAllByRole('option');
    expect(rows[1]!.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Role' }).textContent).toContain('Admin');
  });

  it('greys a person without a login account and does not select them', async () => {
    serveCandidates();
    view();
    const rafi = (await screen.findByText('Rafi Hasan')).closest('[role=option]')!;
    expect(rafi.getAttribute('aria-disabled')).toBe('true');
    expect(rafi.textContent).toContain('No login account. They cannot be chosen.');
    await userEvent.click(rafi);
    expect(rafi.getAttribute('aria-selected')).toBe('false');
  });

  it('blocks Login as until the reason has enough letters', async () => {
    serveCandidates();
    view();
    await screen.findByText('Anika Rahman');
    const submit = screen.getByRole('button', { name: 'Login as' });
    expect(submit).toHaveProperty('disabled', true);
    await userEvent.type(screen.getByRole('textbox', { name: 'Reason' }), 'short');
    expect(screen.getByText('Write at least 10 letters.')).toBeTruthy();
    expect(submit).toHaveProperty('disabled', true);
    await userEvent.click(screen.getByRole('button', { name: 'Checking a bug' }));
    expect(submit).toHaveProperty('disabled', false);
  });

  it('opens the school tab with the code in the fragment and no query', async () => {
    serveCandidates();
    const calls = serveStart();
    const tab = fakeTab();
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    const { onOpenChange } = view();
    await screen.findByText('Anika Rahman');
    await userEvent.click(screen.getByRole('button', { name: 'Support request' }));
    await userEvent.click(screen.getByRole('button', { name: 'Login as' }));
    await waitFor(() => expect(tab.location.href).toContain('/support/enter#code='));
    expect(tab.location.href).toContain('#code=secret-code-123');
    expect(tab.location.href).not.toContain('?');
    expect(openSpy).toHaveBeenCalledWith('about:blank', '_blank');
    expect(calls[0]!.body).toMatchObject({ targetUserId: ANIKA, role: 'ADMIN', viewOnly: false });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(document.body.textContent).not.toContain('secret-code-123');
  });

  it('sends the view-only flag', async () => {
    serveCandidates();
    const calls = serveStart();
    vi.spyOn(window, 'open').mockReturnValue(fakeTab() as unknown as Window);
    view();
    await screen.findByText('Anika Rahman');
    await userEvent.click(screen.getByRole('button', { name: 'Setup help' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /View only/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Login as' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body.viewOnly).toBe(true);
  });

  it('asks for the code and shows a wrong code under the field', async () => {
    serveCandidates();
    server.use(
      http.post('*/platform/impersonation', () =>
        HttpResponse.json(
          {
            statusCode: 403,
            message: 'x',
            timestamp: '2030-01-01T00:00:00.000Z',
            path: '/platform/impersonation',
            requestId: 'r',
            details: { code: 'APPROVAL_REQUIRED' },
          },
          { status: 403 },
        ),
      ),
      http.post('*/platform/step-up', () => HttpResponse.json({ message: 'bad' }, { status: 400 })),
    );
    vi.spyOn(window, 'open').mockReturnValue(fakeTab() as unknown as Window);
    view();
    await screen.findByText('Anika Rahman');
    await userEvent.click(screen.getByRole('button', { name: 'Checking a bug' }));
    await userEvent.click(screen.getByRole('button', { name: 'Login as' }));
    const code = await screen.findByLabelText('Authenticator code');
    await userEvent.type(code, '123456');
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText(/That code isn't valid/)).toBeTruthy();
  });

  it('shows the waiting card for an ask-each-time school and Cancel ends the request', async () => {
    serveCandidates({ supportAccessMode: 'ask' });
    serveStart(() =>
      HttpResponse.json({ id: '33333333-3333-4333-8333-333333333302', status: 'REQUESTED' }),
    );
    let ended = '';
    server.use(
      http.delete('*/platform/impersonation/:id', ({ params }) => {
        ended = String(params.id);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const tab = fakeTab();
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    view();
    await screen.findByText('Anika Rahman');
    await userEvent.click(screen.getByRole('button', { name: 'Checking a bug' }));
    await userEvent.click(screen.getByRole('button', { name: 'Login as' }));
    expect(
      await screen.findByText('Waiting for approval. We told the school admins.'),
    ).toBeTruthy();
    expect(tab.close).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(ended).toBe('33333333-3333-4333-8333-333333333302'));
  });

  it('blocked school: red note, no form until Emergency access, then sends view only', async () => {
    serveCandidates({ supportAccessMode: 'blocked' });
    const calls = serveStart(() =>
      HttpResponse.json(
        {
          statusCode: 403,
          message: 'x',
          timestamp: '2030-01-01T00:00:00.000Z',
          path: '/platform/impersonation',
          requestId: 'r',
          details: {
            code: 'APPROVAL_REQUESTED',
            approvalRequestId: '44444444-4444-4444-8444-444444444401',
          },
        },
        { status: 403 },
      ),
    );
    vi.spyOn(window, 'open').mockReturnValue(fakeTab() as unknown as Window);
    view();
    expect(
      await screen.findByText('This school does not allow Biddaloy support access.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Login as' })).toHaveProperty('disabled', true);
    expect(screen.queryByRole('textbox', { name: 'Reason' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Emergency access' }));
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Why is this an emergency?' }),
      'School cannot take fees today',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Login as' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.body.viewOnly).toBe(true);
  });

  it('no active admin: shows the invite button instead of the form', async () => {
    serveCandidates({ noActiveAdmin: true, candidates: [] });
    const { onInviteAdmin } = view();
    await userEvent.click(await screen.findByRole('button', { name: 'Invite admin' }));
    expect(onInviteAdmin).toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Reason' })).toBeNull();
  });
});
