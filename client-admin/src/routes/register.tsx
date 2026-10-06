import { ensureSessionLoaded } from '@biddaloy/ui/api';
import { AuthLayout } from '@biddaloy/ui/components';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { RegisterFlow } from '../features/registration/register-flow';
import { loadRouteNamespaces } from '../route-loaders';

/** `social_ticket` is the provider the social callback sent the visitor back
 * from (the ticket itself rides an httpOnly cookie). Junk falls back to the
 * plain form rather than a router 404. */
const registerSearchSchema = z.object({
  social_ticket: z.enum(['google', 'facebook']).optional().catch(undefined),
  country: z.string().optional().catch(undefined),
});

/** [13.6.1] Signed-out "Create your school" card; chromeless, no breadcrumb. */
export const Route = createFileRoute('/register')({
  validateSearch: registerSearchSchema,
  // A signed-in visitor has nothing to register.
  beforeLoad: async () => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error
    if (await ensureSessionLoaded()) throw redirect({ to: '/' });
  },
  loader: () => loadRouteNamespaces('register', 'auth', 'common'),
  component: RegisterPage,
});

function RegisterPage() {
  const { social_ticket: provider, country } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <RegisterFlow
        {...(provider ? { socialTicket: { provider } } : {})}
        {...(country ? { initialCountry: country } : {})}
        onDone={() => void navigate({ to: '/welcome' })}
      />
    </AuthLayout>
  );
}
