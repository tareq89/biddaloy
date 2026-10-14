import { logout } from '@biddaloy/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { DEMO_ROLES_KEY } from './use-demo-mode';

/**
 * Sign out, then land on `/login` (a signed-in visitor would be bounced off it). The user menu's
 * "Sign out", its demo "View as another role" and the palette's "Switch demo role" all use it.
 *
 * `logout()` empties the query cache, and the still-mounted shell would at once ask
 * `GET /demo/roles` again: `/login` would show the plain form, then swap in the role cards. The
 * answer is set as the query's `initialData` first; query defaults survive `clear()`.
 */
export function useSignOutToLogin(): () => Promise<void> {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    const demo = queryClient.getQueryData(DEMO_ROLES_KEY);
    if (demo !== undefined) queryClient.setQueryDefaults(DEMO_ROLES_KEY, { initialData: demo });
    try {
      await logout(queryClient);
    } finally {
      // `logout()` clears local auth state even if the network call failed, so always leave.
      void navigate({ to: '/login' });
    }
  };
}
