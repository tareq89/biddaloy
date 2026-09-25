/**
 * Admission applicants list route — [27.10]. Gated centrally (`_staff.tsx`
 * + `route-permissions.ts`), same pattern as `admissions/intakes/index.tsx`
 * (#27.9).
 */
import { createFileRoute } from '@tanstack/react-router';

import { ApplicantList } from '../../../../features/admission/ApplicantList';
import { applicantsQueryOptions } from '../../../../features/admission/hooks/useApplicants';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/admissions/applicants/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(applicantsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('admission-staff-applicants', 'common'),
    ]),
  component: ApplicantList,
});
