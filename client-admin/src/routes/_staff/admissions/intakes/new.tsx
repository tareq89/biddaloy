/** New-round wizard route — chromeless full page. Stub until its screen ticket (#2204 D11). */
import { createFileRoute } from '@tanstack/react-router';

import { RoundWizard } from '../../../../features/admission/desk/RoundWizard';
import { loadRouteNamespaces } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/admissions/intakes/new')({
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('admission-desk', 'common'),
  component: RoundWizard,
});
