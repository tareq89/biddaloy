/**
 * [#4209] Old public admission link (`status`). The form moved to the school website, so this only
 * says so. Kept as a route so shared links and `PUBLIC_PATH_PREFIXES` keep working.
 */
import { createFileRoute } from '@tanstack/react-router';

import { AdmissionMoved } from '../../../features/admission/AdmissionMoved';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/admission/$slug/status')({
  loader: () => loadRouteNamespaces('admission-public'),
  component: AdmissionMoved,
});
