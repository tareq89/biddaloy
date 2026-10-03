import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { TemplatesList } from '../-templates-list';
import { loadRouteNamespaces } from '../../../../route-loaders';

/** [35.5.1] Exams & Results › Exam setup › Templates. Gated `EXAM_MANAGE`
 * by `_staff.tsx` (see `route-permissions.ts`); the list does not self-gate. */
export const Route = createFileRoute('/_staff/exams/templates/')({
  loader: () => loadRouteNamespaces('examTemplates', 'exams', 'common', 'presetWarning'),
  pendingComponent: TemplatesPending,
  component: TemplatesPage,
});

function TemplatesPage() {
  const navigate = useNavigate();
  return (
    <TemplatesList
      renderName={(template) => (
        <Link
          to="/exams/templates/$templateId"
          params={{ templateId: template.id }}
          className="font-medium text-primary underline"
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
