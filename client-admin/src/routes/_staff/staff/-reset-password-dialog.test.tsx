import { setActiveTenant } from '@biddaloy/ui/api';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  renderWithProviders,
  server,
  userResponseFactory,
} from '@biddaloy/ui/test';
import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { ResetPasswordDialog } from './-reset-password-dialog';

const member = userResponseFactory({ id: 'target', full_name: 'Example Member' });
const secret = {
  temporary_password: 'test-only-temporary-secret',
  expires_at: '2030-01-01T12:00:00Z',
};
const endpoint = '/api/v1/users/:id/reset-password';
function Harness({ isSelf = false }: { isSelf?: boolean }) {
  const [open, setOpen] = React.useState(true);
  const { t } = useTranslation('staff');
  return (
    <>
      <button onClick={() => setOpen(true)}>{t('resetPassword.title')}</button>
      <ResetPasswordDialog open={open} onOpenChange={setOpen} user={member} isSelf={isSelf} />
    </>
  );
}
function renderDialog(isSelf = false) {
  return renderWithProviders(<Harness isSelf={isSelf} />, {
    tenantId: 'school-one',
    role: 'ADMIN',
    locale: 'en',
  });
}
afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTestState();
});

it('names consequences and blocks self reset accessibly', async () => {
  renderDialog(true);
  expect(
    await screen.findByText(/old password and all sessions will stop working immediately/),
  ).toBeTruthy();
  expect(screen.getByText(/You cannot reset your own password here/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Reset password' }).hasAttribute('disabled')).toBe(
    true,
  );
  await expect(document.body).toHaveNoViolations();
});
it('reveals once, copies explicitly, clears on close and never caches the secret', async () => {
  let body: unknown;
  server.use(
    http.post(endpoint, async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(secret);
    }),
  );
  const { user, queryClient } = renderDialog();
  const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await user.click(await screen.findByRole('button', { name: 'Reset password' }));
  expect((await screen.findByLabelText<HTMLInputElement>('Temporary password')).value).toBe(
    secret.temporary_password,
  );
  expect(screen.getByText(/^Expires:/)).toBeTruthy();
  expect(body).toEqual({});
  expect(copy).not.toHaveBeenCalled();
  expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Copy temporary password' }));
  expect(copy).toHaveBeenCalledWith(secret.temporary_password);
  await user.click(screen.getAllByRole('button', { name: 'Close' })[0]!);
  await user.click(screen.getByRole('button', { name: 'Reset password' }));
  expect(screen.queryByDisplayValue(secret.temporary_password)).toBeNull();
  expect(screen.getByRole('button', { name: 'Reset password' })).toBeTruthy();
});
it('offers manual copy after clipboard failure', async () => {
  server.use(http.post(endpoint, () => HttpResponse.json(secret)));
  const { user } = renderDialog();
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
  await user.click(await screen.findByRole('button', { name: 'Reset password' }));
  await user.click(await screen.findByRole('button', { name: 'Copy temporary password' }));
  expect(await screen.findByText(/Select the password and copy it manually/)).toBeTruthy();
});
it.each(['close', 'tenant', 'unmount'] as const)(
  'discards a pending secret after %s and disables duplicate submission',
  async (transition) => {
    let resolve!: () => void;
    let calls = 0;
    const barrier = new Promise<void>((done) => {
      resolve = done;
    });
    server.use(
      http.post(endpoint, async () => {
        calls += 1;
        await barrier;
        return HttpResponse.json(secret);
      }),
    );
    const { user, unmount } = renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(calls).toBe(1));
    expect(
      screen.getByRole('button', { name: /Resetting password/ }).hasAttribute('disabled'),
    ).toBe(true);
    if (transition === 'close') {
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await user.click(screen.getByRole('button', { name: 'Reset password' }));
    }
    if (transition === 'tenant') act(() => setActiveTenant('school-two'));
    if (transition === 'unmount') unmount();
    await act(async () => {
      resolve();
      await barrier;
    });
    await waitFor(() => expect(screen.queryByDisplayValue(secret.temporary_password)).toBeNull());
  },
);
it('removes an already displayed secret on tenant switch', async () => {
  server.use(http.post(endpoint, () => HttpResponse.json(secret)));
  const { user } = renderDialog();
  await user.click(await screen.findByRole('button', { name: 'Reset password' }));
  await screen.findByDisplayValue(secret.temporary_password);
  act(() => setActiveTenant('school-two'));
  expect(screen.queryByDisplayValue(secret.temporary_password)).toBeNull();
});
it.each([409, 401, 500])('renders safe errors for %s without retry or refresh', async (status) => {
  let calls = 0;
  let refreshCalls = 0;
  server.use(
    http.post(endpoint, () => {
      calls += 1;
      return HttpResponse.json(
        { statusCode: status, message: 'private server detail', requestId: 'test' },
        { status },
      );
    }),
    http.post('/api/v1/auth/refresh', () => {
      refreshCalls += 1;
      return new HttpResponse(null, { status: 401 });
    }),
  );
  const { user } = renderDialog();
  await user.click(await screen.findByRole('button', { name: 'Reset password' }));
  expect((await screen.findByRole('alert')).textContent).toContain(
    status === 409 ? 'not eligible' : 'Could not reset',
  );
  expect(screen.queryByText('private server detail')).toBeNull();
  expect(calls).toBe(1);
  expect(refreshCalls).toBe(0);
});
