import { isGuardianRole } from '@biddaloy/shared';
import { getActiveRole } from '@biddaloy/ui/api';
import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * `/` — the front door, and nothing else: it renders no UI, it only sends
 * the visitor to their audience's home ([8.9.10]). Staff get `/dashboard`,
 * guardians get `/portal`.
 *
 * This is why the dashboard moved off `/`: two pathless layouts can't both
 * claim `/`, and a redirect route is a clearer front door than a dashboard
 * that quietly bounces some of its visitors elsewhere.
 *
 * `__root.tsx`'s guard has already run by the time this does, so a visitor
 * reaching here is authenticated *and* has both an active tenant and an
 * active role — an unresolved one was sent to `/select-school` instead.
 * That ordering is what keeps this redirect from ever pointing at a route
 * whose own guard would bounce it straight back here.
 */
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect({ to: isGuardianRole(getActiveRole()) ? '/portal' : '/dashboard' });
  },
});
