/**
 * Admission intakes list route — [27.9]. Gated behind `ADMISSION_REVIEW`
 * centrally (`_staff.tsx` + `route-permissions.ts`), not per-component.
 */
import { createFileRoute } from '@tanstack/react-router';

import { intakesQueryOptions } from '../../../../features/admission/hooks/useIntakes';
import { IntakeList } from '../../../../features/admission/IntakeList';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/admissions/intakes/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(intakesQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('admission-staff-intakes', 'common'),
    ]),
  component: IntakeList,
});
