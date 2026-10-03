import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { TemplateDetail } from '../-template-detail';
import { loadRouteNamespaces } from '../../../../route-loaders';

/** [35.5.1] Exam template detail. Gated `EXAM_MANAGE` by `_staff.tsx`. */
export const Route = createFileRoute('/_staff/exams/templates/$templateId')({
  loader: () => loadRouteNamespaces('examTemplates', 'exams', 'common', 'presetWarning'),
  pendingComponent: TemplateDetailPending,
  component: TemplateDetailRoute,
});

function TemplateDetailRoute() {
  const { templateId } = Route.useParams();
  return <TemplateDetail templateId={templateId} />;
}

function TemplateDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
