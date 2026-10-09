import { EmptyState } from '@biddaloy/ui/components';
import { applicationQueryOptions } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

/** [52.4.1] Stub: the W5 detail ticket replaces the body; the loader already warms the detail query. */
export const Route = createFileRoute('/_staff/applications/$applicationId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      queryClient
        .ensureQueryData(applicationQueryOptions(params.applicationId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('applications', 'common'),
    ]),
  component: ApplicationDetailPage,
});

function ApplicationDetailPage() {
  const { t } = useTranslation('applications');
  return (
    <PageContainer>
      <EmptyState headingLevel={1} title={t('stub.title')} explanation={t('stub.explanation')} />
    </PageContainer>
  );
}
