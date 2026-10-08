import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { TemplatesList } from '../-templates-list';
import { loadRouteNamespaces } from '../../../../route-loaders';

/** [35.5.1] Exams & Results › Exam setup › Templates. Gated `EXAM_MANAGE`
 * by `_staff.tsx` (see `route-permissions.ts`); the list does not self-gate. */
// `z.looseObject`, not `z.object`: a plain object would strip every param it does not list.
export const Route = createFileRoute('/_staff/exams/templates/')({
  validateSearch: z.looseObject({ new: z.coerce.string().optional().catch(undefined) }),
  loader: () => loadRouteNamespaces('examTemplates', 'exams', 'common', 'presetWarning'),
  pendingComponent: TemplatesPending,
  component: TemplatesPage,
});

function TemplatesPage() {
  const navigate = useNavigate();
  const routeNavigate = Route.useNavigate();
  const search = Route.useSearch();
  return (
    <TemplatesList
      openCreate={search.new === '1'}
      onCreateClosed={() =>
        void routeNavigate({ search: (prev) => ({ ...prev, new: undefined }), replace: true })
      }
      renderName={(template) => (
        <Link
          to="/exams/templates/$templateId"
          params={{ templateId: template.id }}
          className="inline-flex min-h-11 items-center font-medium hover:text-primary md:min-h-0"
        >
          {template.name}
        </Link>
      )}
      onCreated={(template) =>
        void navigate({ to: '/exams/templates/$templateId', params: { templateId: template.id } })
      }
    />
  );
}

function TemplatesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
