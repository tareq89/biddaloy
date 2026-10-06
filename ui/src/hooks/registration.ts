import type { LoginResponse } from '@biddaloy/shared';
import type { QueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { adoptSession, publicPost } from './auth';

export type RegisterStartInput = components['schemas']['RegisterStartDto'];
export type RegisterVerifyInput = components['schemas']['RegisterVerifyDto'];

/** `POST /auth/register/start|resend` — mirrors the server's `RegisterStartResult`
 * (untyped in `schema.d.ts`). `debug` only exists with the e2e echo flag on. */
export interface RegisterStartResult {
  registration_id: string;
  channel: 'sms' | 'email';
  resend_in: number;
  debug?: { otp: string };
}

export type RegisterVerifyResult = LoginResponse & {
  needs_password: boolean;
  password_required: boolean;
};

// Plain functions, not hooks: they run before a session exists, like `login()`.
export function startRegistration(input: RegisterStartInput): Promise<RegisterStartResult> {
  return publicPost('/auth/register/start', input);
}

export function resendRegistrationCode(registrationId: string): Promise<RegisterStartResult> {
  return publicPost('/auth/register/resend', { registration_id: registrationId });
}

/** Verifying creates the school + admin and issues a session; like `verifyOtp`
 * it is adopted here, so the caller only has to navigate. */
export async function verifyRegistration(
  queryClient: QueryClient,
  input: RegisterVerifyInput,
): Promise<RegisterVerifyResult> {
  const result = await publicPost<RegisterVerifyResult>('/auth/register/verify', input);
  await adoptSession(queryClient, result);
  return result;
}
