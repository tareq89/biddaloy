import { ApplicationType } from '@biddaloy/shared';
import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

/** [52.4.1] Stub: the W5 form ticket replaces the body and relies on these exact search keys. */
const newApplicationSearchSchema = z.object({
  type: z.nativeEnum(ApplicationType).optional().catch(undefined),
  student: z.string().uuid().optional().catch(undefined),
  staff: z.string().uuid().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/applications/new')({
  validateSearch: newApplicationSearchSchema,
  loader: () => loadRouteNamespaces('applications', 'common'),
  component: NewApplicationPage,
});

function NewApplicationPage() {
  const { t } = useTranslation('applications');
  return (
    <PageContainer>
      <EmptyState headingLevel={1} title={t('stub.title')} explanation={t('stub.explanation')} />
    </PageContainer>
  );
}
