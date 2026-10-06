import {
  decodeAccessTokenMemberships,
  ensureSessionLoaded,
  getAccessToken,
} from '@biddaloy/ui/api';
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * [13.6.1] Where the server sends the browser after a social sign-in. No UI
 * of its own: refresh the session from the cookie, then the same branch as
 * `login.tsx` (2+ schools -> picker, otherwise `/`, whose guard decides).
 */
export const Route = createFileRoute('/auth/social/done')({
  beforeLoad: async () => {
    const signedIn = await ensureSessionLoaded();
    const token = getAccessToken();
    const many = token ? decodeAccessTokenMemberships(token).length > 1 : false;
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!signedIn) throw redirect({ to: '/login' });
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect(many ? { to: '/select-school' } : { to: '/' });
  },
  pendingComponent: SocialDonePending,
});

function SocialDonePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label')} />;
}
