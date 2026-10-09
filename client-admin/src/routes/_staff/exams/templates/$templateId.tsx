import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { TemplateDetail } from '../-template-detail';
import { loadRouteNamespaces } from '../../../../route-loaders';

// The class grade being edited (`?grade=`); anything outside 1-99 is ignored.
const templateSearchSchema = z.object({
  grade: z.coerce.number().int().min(1).max(99).optional().catch(undefined),
});

/** [35.5.1] Exam structure detail. Gated `EXAM_MANAGE` by `_staff.tsx`. */
export const Route = createFileRoute('/_staff/exams/templates/$templateId')({
  validateSearch: templateSearchSchema,
  loader: () => loadRouteNamespaces('examTemplates', 'exams', 'common', 'presetWarning'),
  pendingComponent: TemplateDetailPending,
  component: TemplateDetailRoute,
});

function TemplateDetailRoute() {
  const { templateId } = Route.useParams();
  const { grade } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <TemplateDetail
      templateId={templateId}
      selectedGrade={grade}
      onGradeChange={(next) => void navigate({ search: { grade: next }, replace: true })}
    />
  );
}

function TemplateDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
