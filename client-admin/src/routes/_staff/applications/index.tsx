import { ApplicationStatus, ApplicationType } from '@biddaloy/shared';
import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

/** [52.4.1] Stub: the W5 list ticket replaces the body and relies on these exact search keys. */
const applicationsSearchSchema = z.object({
  view: z.enum(['inbox', 'mine', 'all']).optional().catch(undefined),
  type: z.nativeEnum(ApplicationType).optional().catch(undefined),
  status: z.nativeEnum(ApplicationStatus).optional().catch(undefined),
  from: z.string().optional().catch(undefined),
  to: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  q: z.string().optional().catch(undefined),
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  // Row to open after a decision, so the list can scroll back to it.
  decided: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/applications/')({
  validateSearch: applicationsSearchSchema,
  loader: () => loadRouteNamespaces('applications', 'common'),
  component: ApplicationsPage,
});

function ApplicationsPage() {
  const { t } = useTranslation('applications');
  return (
    <PageContainer>
      <EmptyState headingLevel={1} title={t('stub.title')} explanation={t('stub.explanation')} />
    </PageContainer>
  );
}
