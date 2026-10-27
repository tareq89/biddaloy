import { ConfirmDialog, RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useBlocker } from '@tanstack/react-router';
import * as React from 'react';
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
  const { t } = useTranslation('examTemplates');
  const [dirty, setDirty] = React.useState(false);
  const blocker = useBlocker({
    // Switching the class grade only changes `?grade=`; the grid and its draft stay mounted.
    shouldBlockFn: ({ current, next }) => dirty && next.pathname !== current.pathname,
    enableBeforeUnload: false, // TemplateDetail already guards reload / tab close
    withResolver: true,
  });
  return (
    <>
      <TemplateDetail
        templateId={templateId}
        selectedGrade={grade}
        onGradeChange={(next) => void navigate({ search: { grade: next }, replace: true })}
        onDirtyChange={setDirty}
      />
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        tone="danger"
        title={t('detail.leaveTitle')}
        description={t('detail.leaveText')}
        cancelLabel={t('detail.stay')}
        confirmLabel={t('detail.leave')}
        onConfirm={() => blocker.proceed?.()}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      />
    </>
  );
}

function TemplateDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
