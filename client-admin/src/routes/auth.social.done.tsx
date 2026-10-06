import {
  decodeAccessTokenMemberships,
  ensureSessionLoaded,
  getAccessToken,
  getActiveTenant,
} from '@biddaloy/ui/api';
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { z } from 'zod';

import { isSameAppRedirect } from '../same-app-redirect';

/** The server passes the sign-in's `?redirect=` back through
 * (`social-auth.service.ts`); same-app paths only, like `/login`. */
const socialDoneSearchSchema = z.object({
  redirect: z.string().refine(isSameAppRedirect).optional().catch(undefined),
});

/**
 * [13.6.1] Where the server sends the browser after a social sign-in. No UI
 * of its own: refresh the session from the cookie, then the same branch as
 * `login.tsx` (2+ schools and none picked yet -> picker, otherwise the deep
 * link or `/`, whose guard decides). A school restored from an earlier visit
 * skips the picker: the root guard would bounce it to `/` and lose the link.
 */
export const Route = createFileRoute('/auth/social/done')({
  validateSearch: socialDoneSearchSchema,
  beforeLoad: async ({ search }) => {
    const { redirect: to } = search;
    const signedIn = await ensureSessionLoaded();
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (!signedIn) throw redirect({ to: '/login', search: { redirect: to } });
    const token = getAccessToken();
    const pick = !getActiveTenant() && !!token && decodeAccessTokenMemberships(token).length > 1;
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    throw redirect(pick ? { to: '/select-school', search: { redirect: to } } : { to: to ?? '/' });
  },
  pendingComponent: SocialDonePending,
});

function SocialDonePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label')} />;
}
