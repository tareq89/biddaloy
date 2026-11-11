import type {
  CockpitDeviceOtpRequest,
  CockpitEnrolConfirmRequest,
  CockpitEnrolConfirmResponse,
  CockpitEnrolStartRequest,
  CockpitEnrolStartResponse,
  CockpitLoginResponse,
  CockpitMfaRequest,
  CockpitMfaStatusDto,
} from '@biddaloy/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export const cockpitSessionKeys = createEntityKeys('cockpit-sessions');
export const cockpitMfaKeys = createEntityKeys('cockpit-mfa');

/** `GET /auth/cockpit/sessions` row (snake_case, same as the school app's session list). */
export interface CockpitSessionDto {
  id: string;
  started_at: string;
  last_used_at: string;
  user_agent: string | null;
  ip_address: string | null;
  current: boolean;
}

const post = <T, B = unknown>(url: string, data?: B) =>
  cockpitRequest<T>({ method: 'POST', url, data });

/** Email or phone plus password, same shape as the school login. */
export type CockpitLoginInput = ({ email: string } | { phone: string }) & { password: string };

export function useCockpitLogin() {
  return useMutation({
    mutationFn: (input: CockpitLoginInput) =>
      post<CockpitLoginResponse>('/auth/cockpit/login', input),
    retry: false,
  });
}

export function useCockpitMfa() {
  return useMutation({
    mutationFn: (input: CockpitMfaRequest) =>
      post<CockpitLoginResponse>('/auth/cockpit/mfa', input),
    retry: false,
  });
}

export function useCockpitDeviceOtp() {
  return useMutation({
    mutationFn: (input: CockpitDeviceOtpRequest) =>
      post<CockpitLoginResponse>('/auth/cockpit/device-otp', input),
    retry: false,
  });
}

export function useCockpitEnrolStart() {
  return useMutation({
    mutationFn: (input: CockpitEnrolStartRequest) =>
      post<CockpitEnrolStartResponse>('/auth/cockpit/enrol/start', input),
    retry: false,
  });
}

export function useCockpitEnrolConfirm() {
  return useMutation({
    mutationFn: (input: CockpitEnrolConfirmRequest) =>
      post<CockpitEnrolConfirmResponse>('/auth/cockpit/enrol/confirm', input),
    retry: false,
  });
}

/** 202 whether or not the account exists (Rule 18); nothing to read back. */
export function useCockpitForgotPassword() {
  return useMutation({
    mutationFn: (input: { identifier: string }) => post('/auth/cockpit/forgot-password', input),
    retry: false,
  });
}

export function useCockpitResetPassword() {
  return useMutation({
    mutationFn: (input: { token: string; newPassword: string }) =>
      post('/auth/cockpit/reset-password', input),
    retry: false,
  });
}

/**
 * ponytail: `GET /auth/cockpit/mfa-status` and `POST /auth/cockpit/recovery-codes` are not on
 * the server yet (no ticket owns them at the time of writing); the paths are the obvious ones
 * and live only here. Change the two strings if the server lands different ones.
 */
export function useCockpitMfaStatus() {
  return useQuery({
    queryKey: cockpitMfaKeys.all,
    queryFn: ({ signal }) =>
      cockpitRequest<CockpitMfaStatusDto>({ url: '/auth/cockpit/mfa-status', signal }),
    retry: shouldRetryQuery,
  });
}

/** Needs a step-up token for `platform.recovery_codes`; the old codes stop working. */
export function useRegenerateRecoveryCodes() {
  const queryClient = useQueryClient();
  return useApprovedMutation(
    (_: void, { headers }) =>
      cockpitRequest<{ recoveryCodes: string[] }>({
        method: 'POST',
        url: '/auth/cockpit/recovery-codes',
        headers,
      }),
    {
      approvalScope: 'platform.recovery_codes',
      onSuccess: () => queryClient.invalidateQueries({ queryKey: cockpitMfaKeys.all }),
    },
  );
}

export function useCockpitSessions() {
  return useQuery({
    queryKey: cockpitSessionKeys.lists(),
    queryFn: async ({ signal }) =>
      (
        await cockpitRequest<{ data: CockpitSessionDto[] }>({
          url: '/auth/cockpit/sessions',
          signal,
        })
      ).data,
    retry: shouldRetryQuery,
  });
}

export function useRevokeCockpitSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      cockpitRequest({ method: 'DELETE', url: `/auth/cockpit/sessions/${id}` }),
    retry: false,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: cockpitSessionKeys.all }),
  });
}
