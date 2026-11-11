import { AuthLayout, Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  createFileRoute,
  Link,
  Outlet,
  useChildMatches,
  useNavigate,
} from '@tanstack/react-router';
import { z } from 'zod';

import { CockpitSignInCard } from '../features/cockpit/sign-in/cockpit-sign-in-card';
import { loadRouteNamespaces } from '../route-loaders';
import { isSameAppRedirect } from '../same-app-redirect';

/** [98.4.03] Owner sign-in on the cockpit host. Mockup: cockpit-identity-mockups.md section a. */
export const Route = createFileRoute('/sign-in')({
  validateSearch: z.object({
    redirect: z.string().refine(isSameAppRedirect).optional().catch(undefined),
    reset: z.literal('1').optional().catch(undefined),
  }),
  loader: () => loadRouteNamespaces('cockpit', 'common'),
  component: SignInPage,
});

function SignInPage() {
  // `/sign-in/forgot` and `/sign-in/reset` are children of this route: show them, not the card.
  const child = useChildMatches();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { t } = useTranslation('cockpit');
  if (child.length > 0) return <Outlet />;
  return (
    <AuthLayout>
      <CockpitSignInCard
        forgotAction={
          <Button asChild variant="ghost" className="min-h-11 w-full text-primary">
            <Link to={'/sign-in/forgot'}>{t('signIn.forgot')}</Link>
          </Button>
        }
        notice={search.reset ? t('signIn.passwordSaved') : undefined}
        onSignedIn={() => void navigate({ to: search.redirect ?? '/schools' })}
        onEnrol={() => void navigate({ to: '/owner-security/two-step' })}
      />
    </AuthLayout>
  );
}
