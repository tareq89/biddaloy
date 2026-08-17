import type { QueryClient } from '@tanstack/react-query';

import { clearAuthState } from '../api/auth-state';
import { postAuthLogout } from '../api/client';
import { resetSessionBootstrap } from '../api/session';

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
