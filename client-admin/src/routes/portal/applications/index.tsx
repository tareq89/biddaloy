import { ApplicationStatus, ApplicationType } from '@biddaloy/shared';
import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

/** [52.4.1] Stub: the body arrives in 52.6.1. Same search keys as the staff list minus `view`/`class_id`. */
const portalApplicationsSearchSchema = z.object({
  type: z.nativeEnum(ApplicationType).optional().catch(undefined),
  status: z.nativeEnum(ApplicationStatus).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  decided: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/applications/')({
  validateSearch: portalApplicationsSearchSchema,
  loader: () => loadRouteNamespaces('applications', 'common'),
  component: PortalApplicationsPage,
});

function PortalApplicationsPage() {
  const { t } = useTranslation('applications');
  return (
    <PageContainer>
      <EmptyState headingLevel={1} title={t('stub.title')} explanation={t('stub.explanation')} />
    </PageContainer>
  );
}
