import { act, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ApiError } from '../api/errors';
import { server } from '../test/msw/server';
import { apiErrorBody, errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import {
  useCockpitDeviceOtp,
  useCockpitEnrolConfirm,
  useCockpitEnrolStart,
  useCockpitForgotPassword,
  useCockpitLogin,
  useCockpitMfa,
  useCockpitMfaStatus,
  useCockpitResetPassword,
  useCockpitSessions,
  useRegenerateRecoveryCodes,
  useRevokeCockpitSession,
} from './cockpit-auth';

afterEach(async () => {
  await cleanupTestState();
});

// No tenant is set anywhere below on purpose: an owner has none, and `apiClient` would refuse.
describe('cockpit sign-in hooks', () => {
  it('login: sends credentials with no tenant and returns the next step', async () => {
    let body: unknown;
    let tenantHeader: string | null = 'unset';
    server.use(
      http.post('*/auth/cockpit/login', async ({ request }) => {
        body = await request.json();
        tenantHeader = request.headers.get('x-tenant-id');
        return HttpResponse.json({ step: 'mfa', mfaToken: 't' });
      }),
    );
    const { result } = renderHookWithProviders(() => useCockpitLogin());
    expect(result.current.isPending).toBe(false);
    await act(() => result.current.mutateAsync({ email: 'o@example.test', password: 'pw' }));
    await waitFor(() => expect(result.current.data).toEqual({ step: 'mfa', mfaToken: 't' }));
    expect(body).toEqual({ email: 'o@example.test', password: 'pw' });
    expect(tenantHeader).toBeNull();
  });

  it('login: a 401 comes out as an ApiError and is never retried', async () => {
    let calls = 0;
    server.use(
      http.post('*/auth/cockpit/login', () => {
        calls += 1;
        return HttpResponse.json(apiErrorBody(401, 'Invalid credentials', '/'), { status: 401 });
      }),
    );
    const { result } = renderHookWithProviders(() => useCockpitLogin());
    act(() => result.current.mutate({ email: 'o@example.test', password: 'bad' }));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect((result.current.error as ApiError).statusCode).toBe(401);
    expect(calls).toBe(1);
  });

  it.each([
    ['mfa', useCockpitMfa, { mfaToken: 't', code: '123456' }],
    ['device-otp', useCockpitDeviceOtp, { deviceToken: 't', smsCode: '1', emailCode: '2' }],
  ] as const)('%s: returns the done step', async (_name, useHook, input) => {
    const { result } = renderHookWithProviders(() => useHook());
    await act(() => result.current.mutateAsync(input as never));
    await waitFor(() =>
      expect(result.current.data).toEqual({ step: 'done', access_token: 'cockpit-token' }),
    );
  });

  it('enrol start and confirm return the secret and the recovery codes', async () => {
    const start = renderHookWithProviders(() => useCockpitEnrolStart());
    await act(() =>
      start.result.current.mutateAsync({ enrolToken: 't', smsCode: '1', emailCode: '2' }),
    );
    await waitFor(() => expect(start.result.current.data?.secret).toBe('JBSWY3DPEHPK3PXP'));
    const confirm = renderHookWithProviders(() => useCockpitEnrolConfirm());
    await act(() => confirm.result.current.mutateAsync({ enrolToken: 't', code: '123456' }));
    await waitFor(() => expect(confirm.result.current.data?.recoveryCodes).toHaveLength(1));
  });

  it('forgot and reset password succeed on 202 / 204', async () => {
    const forgot = renderHookWithProviders(() => useCockpitForgotPassword());
    await act(() => forgot.result.current.mutateAsync({ identifier: 'o@example.test' }));
    await waitFor(() => expect(forgot.result.current.isSuccess).toBe(true));
    const reset = renderHookWithProviders(() => useCockpitResetPassword());
    await act(() => reset.result.current.mutateAsync({ token: 't', newPassword: 'Newpass#12345' }));
    await waitFor(() => expect(reset.result.current.isSuccess).toBe(true));
  });
});

describe('cockpit security hooks', () => {
  it('mfa status: loading then data', async () => {
    const { result } = renderHookWithProviders(() => useCockpitMfaStatus());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() =>
      expect(result.current.data).toEqual({ enrolled: true, recoveryRemaining: 8 }),
    );
  });

  it('sessions: unwraps data; revoke succeeds on 204', async () => {
    const { result } = renderHookWithProviders(() => ({
      list: useCockpitSessions(),
      revoke: useRevokeCockpitSession(),
    }));
    await waitFor(() => expect(result.current.list.data).toHaveLength(1));
    await waitFor(() => expect(result.current.list.data?.[0]?.current).toBe(true));
    await act(() => result.current.revoke.mutateAsync('s1'));
    await waitFor(() => expect(result.current.revoke.isSuccess).toBe(true));
  });

  it('sessions: a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/auth/cockpit/sessions', 500));
    const { result } = renderHookWithProviders(() => useCockpitSessions());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('regenerate recovery codes: asks for an authenticator code when the server wants approval', async () => {
    server.use(
      http.post('*/auth/cockpit/recovery-codes', () =>
        HttpResponse.json(
          { ...apiErrorBody(403, 'Forbidden', '/'), details: { code: 'APPROVAL_REQUIRED' } },
          { status: 403 },
        ),
      ),
    );
    const { result } = renderHookWithProviders(() => useRegenerateRecoveryCodes());
    act(() => result.current.mutate());
    // Stays pending: the host modal is open waiting for the code (see approval.test.tsx).
    await waitFor(() => expect(result.current.isPending).toBe(true));
    expect(result.current.isError).toBe(false);
  });
});
