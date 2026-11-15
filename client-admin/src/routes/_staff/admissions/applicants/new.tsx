/** Clerk entry route — full page, not a modal. Stub until its screen ticket (#2204 D11). */
import { createFileRoute } from '@tanstack/react-router';

import { ClerkEntryPage } from '../../../../features/admission/desk/ClerkEntryPage';
import { loadRouteNamespaces } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/admissions/applicants/new')({
  validateSearch: (s: Record<string, unknown>) => ({
    round: typeof s.round === 'string' ? s.round : undefined,
  }),
  loader: () => loadRouteNamespaces('admission-desk', 'common'),
  component: ClerkEntryPage,
});
