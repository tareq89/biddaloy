import type { LoginResponse } from '@biddaloy/shared';
import type { QueryClient } from '@tanstack/react-query';

import { clearAuthState, setAccessToken } from '../api/auth-state';
import {
  apiClient,
  postAuthActivate,
  postAuthForgotPassword,
  postAuthLogin,
  postAuthLogout,
  postAuthResetPassword,
  type ForgotPasswordResponse,
} from '../api/client';
import { NoMembershipsError } from '../api/errors';
import { resetSessionBootstrap, scheduleTokenRefresh } from '../api/session';

import { switchActiveTenant } from './tenant';

/**
 * Everything a successful `LoginResponse` needs applied to leave the app in
 * a working state, factored out of `login()` (12.2) so `activate()` below
 * can share it exactly rather than re-deriving it: store the access token,
 * arm [8.9.3]'s proactive pre-expiry refresh timer, and — for a single
 * membership only — pick it as the active tenant. See `login()`'s own
 * comment for the reasoning behind the single-vs-multi-membership split and
 * the zero-membership rejection; both callers share it unchanged.
 */
async function adoptSession(
  queryClient: QueryClient,
  result: LoginResponse,
): Promise<LoginResponse> {
  const [primary] = result.memberships;
  if (!primary) {
    await postAuthLogout('/auth/logout').catch(() => {
      // Best-effort, see login()'s own comment on this same call.
    });
    throw new NoMembershipsError();
  }

  clearAuthState();
  queryClient.clear();

  setAccessToken(result.access_token);
  scheduleTokenRefresh(result.access_token);
  if (result.memberships.length === 1) {
    switchActiveTenant(queryClient, primary.tenantId, primary.role);
  }

  return result;
}

/**
 * `logout`/`logoutAll` mirror `tenant.ts`'s `switchActiveTenant(queryClient,
 * ...)` shape — a plain function taking the caller's `QueryClient`, not a
 * hook, so a future logout button just does
 * `const queryClient = useQueryClient(); onClick={() => logout(queryClient)}`.
 *
 * Both revoke server-side first, via `postAuthLogout` (not `apiClient` —
 * `apiClient` requires an active tenant and a session restored from a
 * cold-boot refresh can have an access token before one is picked, which
 * would silently skip the server call entirely; see that function's own
 * comment). Local cleanup (`resetSessionBootstrap` clears the
 * proactive-refresh timer and the cold-boot bootstrap memo, `clearAuthState`
 * drops the token/tenant/role, `queryClient.clear()` drops every cached
 * query — every cached query in this app is tenant-scoped, per `tenant.ts`'s
 * own reasoning) runs in a `finally`, so a browser that's actually offline
 * still ends up logged out locally even though the server never heard about
 * it. The network error (if any) still propagates after that cleanup —
 * nothing calls this today, so there's no UI yet choosing whether to
 * surface "logged out, but couldn't reach the server"; a future caller that
 * wants to should wrap the call in its own `.catch()`.
 */
/**
 * `postAuthLogin` (the network call) plus everything a real login needs to
 * leave the app in a working state: store the access token, arm [8.9.3]'s
 * proactive pre-expiry refresh timer (`scheduleTokenRefresh` was exported
 * from `session.ts` specifically for this call site), and — for a single
 * membership only — pick it as the active tenant so the very next
 * `apiClient` request doesn't throw `NoActiveTenantError`.
 *
 * [8.9.5]: a *single* membership sets itself, exactly like before. Two or
 * more is deliberately left unresolved here — no silent `memberships[0]`
 * pick — because the caller (`client-admin/src/routes/login.tsx`) is
 * responsible for routing to the `/select-school` picker in that case;
 * the token (with every membership's name already in it, see
 * `JwtMembership.name`) is set below either way, so that route can decode
 * the list itself without a second request. The zero-membership case below
 * is unaffected by this.
 *
 * Zero memberships (a user removed from every school they used to belong
 * to) is a real, reachable case. Local auth state is deliberately not set
 * until *after* that check: `postAuthLogin` already succeeded server-side
 * by this point — a real access token exists and the server has set the
 * httpOnly refresh cookie — so a memberless account would otherwise leave
 * behind a fully "authenticated" session with nowhere useful to go
 * (`__root.tsx`'s guard only checks *for* a token, not for an active
 * tenant, and a page reload would silently restore that same unusable
 * session via the refresh cookie). Revoking via `postAuthLogout` before
 * throwing closes that session server-side too — it only needs the refresh
 * cookie the browser just stored, not the access token this function never
 * sets in this branch (see `postAuthLogout`'s own comment on why the
 * access token is optional for `/auth/logout`).
 */
export async function login(
  queryClient: QueryClient,
  credentials: ({ email: string } | { phone: string }) & { password: string },
): Promise<LoginResponse> {
  const result = await postAuthLogin(credentials);
  return adoptSession(queryClient, result);
}

/**
 * 12.2's `/activate` route: consumes the invite token, sets the password,
 * and — like `login()` — leaves the app in a signed-in state via
 * `adoptSession`. Same membership-count contract as `login()`: a single
 * membership picks itself, 2+ leaves the choice to `/select-school`, and
 * zero memberships throws `NoMembershipsError` after best-effort revoking
 * the session the server just issued.
 */
export async function activate(
  queryClient: QueryClient,
  input: { token: string; password: string },
): Promise<LoginResponse> {
  const result = await postAuthActivate(input);
  return adoptSession(queryClient, result);
}

/**
 * 12.3's `/forgot-password` step: dispatches an OTP (phone) or reset link
 * (email) by identifier. Always resolves — enumeration-safe, per
 * `RecoveryService.forgot`'s own contract — never a `NoMembershipsError` or
 * any other rejection for "no such account"; only a genuine network/429
 * failure throws (`postAuthForgotPassword` already turns 429 into
 * `RateLimitedError`).
 */
export async function forgotPassword(identifier: string): Promise<ForgotPasswordResponse> {
  return postAuthForgotPassword(identifier);
}

/**
 * 12.3's `/reset-password` step: exactly one of `{ phone, otp }` (SMS OTP)
 * or `{ token }` (emailed link), matching `ResetPasswordDto`. Like
 * `activate()`, a successful reset leaves the app signed in via
 * `adoptSession` — the whole point of this flow is that the caller ends up
 * logged back into their own account, not just holding a changed password.
 */
export async function resetPassword(
  queryClient: QueryClient,
  input: { new_password: string } & ({ phone: string; otp: string } | { token: string }),
): Promise<LoginResponse> {
  const result = await postAuthResetPassword(input);
  return adoptSession(queryClient, result);
}

/**
 * [8.14.4]'s `/portal/account` password card — `POST /auth/change-password`
 * (`AuthController.changePassword`). The server revokes every refresh
 * token for this account and re-issues one for *this* device in the same
 * response (`LoginResponseDto`), so — unlike `login`/`endSession` — this
 * deliberately does **not** call `clearAuthState()` or `queryClient.clear()`.
 * This device's session keeps working uninterrupted (that's the whole
 * point of "change your password without being logged out"); every *other*
 * device simply finds its old refresh token rejected the next time it
 * tries to refresh, which is the "revokes other sessions" AC without this
 * tab ever treating its own, still-valid session as expired.
 *
 * No `switchActiveTenant`/membership handling either: unlike `login`, the
 * caller never leaves the tenant/role they were already acting as — a
 * password change carries no membership list to pick from.
 */
export async function changePassword(input: {
  current_password: string;
  new_password: string;
}): Promise<LoginResponse> {
  const result = await apiClient.post<LoginResponse>('/auth/change-password', input);
  setAccessToken(result.data.access_token);
  scheduleTokenRefresh(result.data.access_token);
  return result.data;
}

async function endSession(
  queryClient: QueryClient,
  endpoint: '/auth/logout' | '/auth/logout-all',
): Promise<void> {
  try {
    await postAuthLogout(endpoint);
  } finally {
    resetSessionBootstrap();
    clearAuthState();
    queryClient.clear();
  }
}

export function logout(queryClient: QueryClient): Promise<void> {
  return endSession(queryClient, '/auth/logout');
}

export function logoutAll(queryClient: QueryClient): Promise<void> {
  return endSession(queryClient, '/auth/logout-all');
}
