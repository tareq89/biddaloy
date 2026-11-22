import { RoutePending } from '@biddaloy/ui/components';
import { useExamProgress, useExams, useMarkGrid } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { MarksSmsPreviewPanel } from './-marks-sms-preview';

/**
 * `/marks/:examId/:sectionId/:subjectId/sms` — [80.3.03] D14: the marks SMS review as its own
 * full page (a sibling of the grid, same trick as the `import` route). Closing lands on the grid.
 *
 * The permission check is a UX gate only: the preview and send routes enforce MARKS_SMS_SEND and
 * grid scope themselves.
 */
export const Route = createFileRoute('/_staff/marks/$examId/$sectionId/$subjectId_/sms')({
  loader: () => loadRouteNamespaces('marksSms', 'exams', 'common'),
  pendingComponent: MarksSmsPending,
  component: MarksSmsPage,
});

function MarksSmsPage() {
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <MarksSmsContent />
    </RegionConfigProvider>
  );
}

function MarksSmsContent() {
  const { examId, sectionId, subjectId } = Route.useParams();
  const { t, i18n } = useTranslation('marksSms');
  const navigate = useNavigate();
  const exam = useExams({ limit: 50 }).data?.data.find((e) => e.id === examId);
  const progressRows = useExamProgress(examId).data?.grids;
  const grid = useMarkGrid(examId, sectionId, subjectId).data;
  const row = progressRows?.find((r) => r.section_id === sectionId && r.subject_id === subjectId);
  const bn = i18n.language.startsWith('bn');
  const subject = (bn ? (row?.subject_name_bn ?? row?.subject_name) : row?.subject_name) ?? '';
  const sectionName = row?.section_name ?? '';

  const studentNames = React.useMemo(
    () => new Map((grid?.students ?? []).map((s) => [s.id, s.full_name])),
    [grid],
  );

  // "Marks SMS — <subject>, <section>"
  const heading = [subject, sectionName].filter(Boolean).join(', ');
  React.useEffect(() => {
    document.title = heading ? `${t('title')} — ${heading}` : t('title');
  }, [heading, t]);

  const backToGrid = () =>
    void navigate({
      to: '/marks/$examId/$sectionId/$subjectId',
      params: { examId, sectionId, subjectId },
    });
  const close = useCloseFullPage(backToGrid);

  return (
    <FullPageShell title={t('title')} size="wide" onClose={close}>
      <div className="flex flex-col gap-4">
        {subject && <p className="text-text-secondary">{t('intro', { subject })}</p>}
        <MarksSmsPreviewPanel
          grid={{ examId, sectionId, subjectId }}
          studentNames={studentNames}
          examPublished={exam?.status === 'PUBLISHED'}
        />
      </div>
    </FullPageShell>
  );
}

function MarksSmsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
