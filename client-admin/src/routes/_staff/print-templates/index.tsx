/**
 * Print template library — [32.4.1]. `?new=1` opens the "New template" dialog straight
 * away (the command palette's "New print template", and the preview's "no template yet").
 */
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { PrintTemplateLibrary } from '../../../components/print/library/print-template-library';
import { loadRouteNamespaces } from '../../../route-loaders';

const searchSchema = z.object({
  new: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/print-templates/')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('printTemplates', 'common'),
  component: PrintTemplatesPage,
});

function PrintTemplatesPage() {
  useTranslation('printTemplates');
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  return (
    <PrintTemplateLibrary
      openNewDialog={search.new === '1'}
      onEdit={(templateId) =>
        void navigate({ to: '/print-templates/$templateId/edit', params: { templateId } })
      }
    />
  );
}
