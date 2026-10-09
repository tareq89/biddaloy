/**
 * Admission reports route — [39.4.2]. Gated centrally (`_staff.tsx` +
 * `route-permissions.ts`, `STUDENT_LIFECYCLE_MANAGE`), same pattern as
 * `admissions/applicants/index.tsx`. The screen's own hooks fetch the data
 * (year/class filters decide the query), so the loader only loads the i18n
 * namespaces.
 */
import { createFileRoute } from '@tanstack/react-router';

import { AdmissionReports } from '../../../../features/admission/AdmissionReports';
import { loadRouteNamespaces } from '../../../../route-loaders';

export const Route = createFileRoute('/_staff/admissions/reports/')({
  loader: () => loadRouteNamespaces('admission-reports', 'common'),
  component: AdmissionReports,
});
