/**
 * Admission applicant detail route — [27.10]. Same loader/gating pattern as
 * `admissions/intakes/$intakeId.tsx` (#27.9).
 */
import { createFileRoute } from '@tanstack/react-router';

import { ApplicantDetail } from '../../../../features/admission/ApplicantDetail';
import { applicantQueryOptions } from '../../../../features/admission/hooks/useApplicants';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/admissions/applicants/$applicantId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(applicantQueryOptions(params.applicantId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('admission-staff-applicants', 'common'),
    ]),
  component: ApplicantDetailPage,
});

function ApplicantDetailPage() {
  const { applicantId } = Route.useParams();
  return <ApplicantDetail applicantId={applicantId} />;
}
