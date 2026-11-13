import '@biddaloy/ui/test';

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import bn from '../../../../../ui/src/i18n/locales/bn/schoolControl.json';
import en from '../../../../../ui/src/i18n/locales/en/schoolControl.json';

import { StuckAdminDialog } from './stuck-admin-dialog';

const admin = (id: string, name: string, status = 'ACTIVE') => ({
  user_id: id,
  name,
  email: `${name.toLowerCase()}@example.test`,
  phone: null,
  membership_status: status,
  invitation: null,
});
const serveAdmins = (...list: ReturnType<typeof admin>[]) =>
  server.use(http.get('*/platform/schools/:id/admins', () => HttpResponse.json(list)));

const view = () =>
  renderWithProviders(
    <ApprovalModalHostProvider>
      <StuckAdminDialog
        open
        onOpenChange={() => undefined}
        schoolId="s-1"
        schoolName="Rose Valley"
      />
    </ApprovalModalHostProvider>,
    { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' },
  );

const approvalGate =
  (calls: (string | null)[], fail = false) =>
  ({ request }: { request: Request }) => {
    const token = request.headers.get('X-Approval-Token');
    calls.push(token);
    if (token && !fail) return null;
    return HttpResponse.json(
      {
        statusCode: token ? 500 : 403,
        message: 'leaky server text',
        timestamp: '',
        path: '/',
        requestId: 'r',
        details: token ? undefined : { code: 'APPROVAL_REQUIRED' },
      },
      { status: token ? 500 : 403 },
    );
  };

async function enterCode(user: ReturnType<typeof userEvent.setup>, code = '123456') {
  await user.type(await screen.findByLabelText('Authenticator code'), code);
  await user.keyboard('{Enter}');
}

afterEach(async () => {
  await cleanupTestState();
});

describe('StuckAdminDialog', () => {
  it('sends a reset link to the chosen admin after a code', async () => {
    serveAdmins(admin('u-1', 'Rahim'), admin('u-2', 'Karim', 'SUSPENDED'));
    const calls: (string | null)[] = [];
    const gate = approvalGate(calls);
    server.use(
      http.post(
        '*/platform/schools/:id/admins/:userId/reset-link',
        (info) =>
          gate(info) ??
          HttpResponse.json({ channel: 'SMS', expiresAt: '2030-01-01T00:00:00.000Z' }),
      ),
    );
    const user = userEvent.setup();
    const { container } = view();
    await user.click(await screen.findByRole('radio', { name: /Rahim/ }));
    expect(screen.queryByRole('radio', { name: /Karim/ })).toBeNull();
    await expect(container).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: 'Send password reset link' }));
    await enterCode(user);
    await screen.findByText('Link sent by SMS.');
    expect(calls).toEqual([null, 'owner-token']);
  });

  it('a wrong code sends nothing', async () => {
    serveAdmins(admin('u-1', 'Rahim'));
    const calls: (string | null)[] = [];
    const gate = approvalGate(calls);
    server.use(
      http.post(
        '*/platform/schools/:id/admins/:userId/reset-link',
        (info) => gate(info) ?? HttpResponse.json({ channel: 'SMS', expiresAt: '' }),
      ),
      http.post('*/platform/step-up', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'nope', timestamp: '', path: '/', requestId: 'r' },
          { status: 403 },
        ),
      ),
    );
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('radio', { name: /Rahim/ }));
    await user.click(screen.getByRole('button', { name: 'Send password reset link' }));
    await enterCode(user, '000000');
    expect(await screen.findByText(/isn't valid/)).toBeTruthy();
    expect(calls).toEqual([null]);
  });

  it('a server error on the link shows a fixed sentence, no echo', async () => {
    serveAdmins(admin('u-1', 'Rahim'));
    const gate = approvalGate([], true);
    server.use(
      http.post(
        '*/platform/schools/:id/admins/:userId/reset-link',
        (info) => gate(info) ?? HttpResponse.json({}),
      ),
    );
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('radio', { name: /Rahim/ }));
    await user.click(screen.getByRole('button', { name: 'Send password reset link' }));
    await enterCode(user);
    await screen.findByText('Could not send the link. Try again.');
    expect(document.body.textContent).not.toContain('leaky server text');
  });

  it('no active admin shows only the invite path', async () => {
    serveAdmins(admin('u-2', 'Karim', 'SUSPENDED'));
    view();
    expect(
      await screen.findByText('This school has no active admin. Invite one first.'),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite another admin' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Send password reset link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log out everyone in this school' })).toBeNull();
  });

  it('Invite another admin opens the add-admin dialog', async () => {
    serveAdmins();
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('button', { name: 'Invite another admin' }));
    await waitFor(() => expect(screen.getAllByRole('dialog', { hidden: true }).length).toBe(2));
  });

  it('log out everyone: confirm, code, then the count', async () => {
    serveAdmins(admin('u-1', 'Rahim'));
    const calls: (string | null)[] = [];
    const gate = approvalGate(calls);
    server.use(
      http.post(
        '*/platform/schools/:id/logout-all',
        (info) => gate(info) ?? HttpResponse.json({ usersSignedOut: 14 }, { status: 201 }),
      ),
    );
    const user = userEvent.setup();
    view();
    await user.click(
      await screen.findByRole('button', { name: 'Log out everyone in this school' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Log out everyone' }));
    await enterCode(user);
    await screen.findByText('14 people logged out.');
    expect(calls).toEqual([null, 'owner-token']);
  });

  it('log out everyone: a server error shows a fixed sentence', async () => {
    serveAdmins(admin('u-1', 'Rahim'));
    const gate = approvalGate([], true);
    server.use(
      http.post('*/platform/schools/:id/logout-all', (info) => gate(info) ?? HttpResponse.json({})),
    );
    const user = userEvent.setup();
    view();
    await user.click(
      await screen.findByRole('button', { name: 'Log out everyone in this school' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Log out everyone' }));
    await enterCode(user);
    await screen.findByText('Could not log everyone out. Try again.');
    expect(document.body.textContent).not.toContain('leaky server text');
  });
});

// Glossary never-say list (docs/ux-research/tenant-control-glossary.md, D14).
const NEVER =
  /\b(impersonat\w*|act(s|ed|ing)? as|break-glass|consent|sessions?|revoke[sd]?|kill(s|ed)?|mode|policy|justification|user_id)\b|সেশন/i;
const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Object.values(v as object).flatMap(strings);
const keys = (v: unknown, p = ''): string[] =>
  typeof v === 'string'
    ? [p]
    : Object.entries(v as object).flatMap(([k, x]) => keys(x, `${p}.${k}`));

describe('school control words', () => {
  it.each([
    ['en', en],
    ['bn', bn],
  ])('%s has no never-say word', (_lang, json) => {
    expect(strings(json).filter((s) => NEVER.test(s))).toEqual([]);
  });

  it('bn and en have the same keys', () => {
    expect(keys(bn)).toEqual(keys(en));
  });
});
