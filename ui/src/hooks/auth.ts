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

  const [primary] = result.memberships;
  if (!primary) {
    await postAuthLogout('/auth/logout').catch(() => {
      // Best-effort: the refresh cookie's own expiry is the fallback if
      // this revoke call fails (offline, transient 5xx) — the important
      // guarantee is that *local* state below never got set in this
      // branch, so this browser tab isn't left looking authenticated
      // either way.
    });
    throw new NoMembershipsError();
  }

  // A second account logging into the same browser tab must not inherit
  // the previous session's active tenant/role, its persisted-tenant hint
  // (`clearAuthState()` already clears that — see its own comment), or its
  // React Query cache — every cached query is tenant-scoped (`tenant.ts`'s
  // own reasoning). Left uncleared for a 2+ membership login below, a
  // stale active tenant here would also silently suppress `__root.tsx`'s
  // redirect to `/select-school`, skipping the picker entirely.
  clearAuthState();
  queryClient.clear();

  setAccessToken(result.access_token);
  scheduleTokenRefresh(result.access_token);
  if (result.memberships.length === 1) {
    switchActiveTenant(queryClient, primary.tenantId, primary.role);
  }

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
