/**
 * [27.8] `/admission/<slug>` — the public application form. No auth, no
 * `AppShell`, same reasoning as `client-admin/src/routes/i/$token.tsx`:
 * never import anything that reads auth state here.
 *
 * `__root.tsx`'s `PUBLIC_PATH_PREFIXES` includes `/admission/` (added by
 * this ticket, one line, alongside the existing `/i/` entry) — without it
 * an unauthenticated visitor bounces to `/login` before this ever renders.
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { AdmissionConfirmation } from '../../../features/admission/AdmissionConfirmation';
import { PublicAdmissionForm } from '../../../features/admission/PublicAdmissionForm';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/admission/$slug/')({
  loader: () => loadRouteNamespaces('admission-public'),
  component: PublicAdmissionRoute,
});

function PublicAdmissionRoute() {
  useTranslation('admission-public');
  const { slug } = Route.useParams();
  const [submitted, setSubmitted] = React.useState<{
    reference_number: string;
    status: string;
  } | null>(null);

  return (
    <div className="flex min-h-screen justify-center bg-muted/20 p-4 sm:p-6">
      <div className="w-full max-w-md">
        {submitted ? (
          <AdmissionConfirmation slug={slug} referenceNumber={submitted.reference_number} />
        ) : (
          <PublicAdmissionForm slug={slug} onSubmitted={setSubmitted} />
        )}
      </div>
    </div>
  );
}
