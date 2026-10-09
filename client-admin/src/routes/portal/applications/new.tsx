import { ApplicationType } from '@biddaloy/shared';
import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

/** [52.4.1] Stub: the body arrives in 52.6.1. Same search keys as the staff form. */
const portalNewApplicationSearchSchema = z.object({
  type: z.nativeEnum(ApplicationType).optional().catch(undefined),
  student: z.string().uuid().optional().catch(undefined),
  staff: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/applications/new')({
  validateSearch: portalNewApplicationSearchSchema,
  loader: () => loadRouteNamespaces('applications', 'common'),
  component: PortalNewApplicationPage,
});

function PortalNewApplicationPage() {
  const { t } = useTranslation('applications');
  return (
    <PageContainer>
      <EmptyState headingLevel={1} title={t('stub.title')} explanation={t('stub.explanation')} />
    </PageContainer>
  );
}
