/** Admission desk route — one round's work screen. Stub until its screen ticket (#2204 D11). */
import { createFileRoute } from '@tanstack/react-router';

import { AdmissionDesk } from '../../../../features/admission/desk/AdmissionDesk';
import { loadRouteNamespaces } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/admissions/rounds/$roundId')({
  loader: () => loadRouteNamespaces('admission-desk', 'common'),
  component: AdmissionDesk,
});
