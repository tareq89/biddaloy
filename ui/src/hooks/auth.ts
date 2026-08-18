import type { LoginResponse } from '@biddaloy/shared';
import type { QueryClient } from '@tanstack/react-query';

import { clearAuthState, setAccessToken } from '../api/auth-state';
import { postAuthLogin, postAuthLogout } from '../api/client';
import { NoMembershipsError } from '../api/errors';
import { resetSessionBootstrap, scheduleTokenRefresh } from '../api/session';

import { switchActiveTenant } from './tenant';

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
 * from `session.ts` specifically for this call site), and pick an active
 * tenant so the very next `apiClient` request doesn't throw
 * `NoActiveTenantError`.
 *
 * Tenant selection here is deliberately the simplest thing that works, not
 * the real thing: a single membership sets itself, more than one silently
 * picks `memberships[0]` with no user choice at all. [8.9.5] ("pick a
 * school when I belong to several") replaces this with a real picker —
 * until it ships, a multi-membership user is briefly one silent step away
 * from acting in the wrong school, exactly the risk [8.9.5] exists to
 * remove. Zero memberships (a user removed from every school they used to
 * belong to) is a real, reachable case — the login itself succeeded, so
 * there's a token to clean up, but there's no tenant to select, so this
 * throws `NoMembershipsError` for the caller to translate into copy rather
 * than silently leaving the app tenant-less.
 */
export async function login(
  queryClient: QueryClient,
  credentials: ({ email: string } | { phone: string }) & { password: string },
): Promise<LoginResponse> {
  const result = await postAuthLogin(credentials);

  setAccessToken(result.access_token);
  scheduleTokenRefresh(result.access_token);

  const [primary] = result.memberships;
  if (!primary) {
    throw new NoMembershipsError();
  }
  switchActiveTenant(queryClient, primary.tenantId, primary.role);

  return result;
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
