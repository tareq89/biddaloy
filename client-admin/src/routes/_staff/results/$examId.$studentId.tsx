/**
 * [19.8.1] step 5: the printable report card. Fetches the student's
 * result detail, the grading scale it was computed against (for the
 * legend — `useGradingScale(result.grading_scale_id)`, not duplicated
 * server-side, see `ResultsService.getStudentResult`'s own comment), and
 * the school's own profile for the header (`IssuerHeader`, D6).
 */
import {
  ErrorState,
  ReportCard,
  RoutePending,
  Skeleton,
  StatusBadge,
  type ReportCardData,
} from '@biddaloy/ui/components';
import { useExam, useGradingScale, useResultDetail, useSchoolProfile } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, PageContainer } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';

import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/results/$examId/$studentId')({
  loader: () => loadRouteNamespaces('exams', 'grading', 'common'),
  pendingComponent: ReportCardPending,
  component: ReportCardPage,
});

function ReportCardPage() {
  const { examId, studentId } = Route.useParams();
  const { t, i18n } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const config = useRegionConfig();
  const examQuery = useExam(examId);
  const detailQuery = useResultDetail(examId, studentId);
  const scaleQuery = useGradingScale(detailQuery.data?.result.grading_scale_id);
  const profileQuery = useSchoolProfile();

  const isLoading = examQuery.isPending || detailQuery.isPending || profileQuery.isPending;
  const isError = examQuery.isError || detailQuery.isError || profileQuery.isError;

  if (isLoading) {
    return (
      <PageContainer>
        <div aria-busy="true" className="space-y-4">
          <Skeleton className="h-7 w-48" />
          <div className="flex gap-6">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-4 w-24" />
            ))}
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </PageContainer>
    );
  }
  if (isError || !examQuery.data || !detailQuery.data || !profileQuery.data) {
    return (
      <PageContainer>
        <ErrorState
          message={t('reportCard.loadError')}
          onRetry={() => {
            void examQuery.refetch();
            void detailQuery.refetch();
          }}
        />
      </PageContainer>
    );
  }

  const detail = detailQuery.data;
  const data: ReportCardData = {
    exam_name: examQuery.data.name,
    student: detail.student,
    result: detail.result,
    subjects: detail.subjects,
    legend: (scaleQuery.data?.bands ?? []).map((band) => ({
      grade: band.grade,
      gpa: band.gpa,
      comment: band.comment,
    })),
  };

  const profile = profileQuery.data;

  return (
    <>
      <div className="print:hidden">
        <DetailShell
          name={detail.student.full_name}
          statusBadge={
            <StatusBadge
              tone={detail.result.is_fail ? 'danger' : 'success'}
              label={t(detail.result.is_fail ? 'resultsPanel.fail' : 'resultsPanel.pass')}
            />
          }
          facts={[
            { label: t('reportCard.examLabel'), value: examQuery.data.name },
            {
              label: t('reportCard.rollLabel'),
              value: formatNumber(detail.student.roll_number, config),
            },
            {
              label: t('reportCard.gpa'),
              value: tg('resultsPage.gpaValue', {
                gpa: formatNumber(detail.result.gpa, config, { decimals: 2 }),
                grade: detail.result.grade,
              }),
            },
            {
              label: t('reportCard.position'),
              value: formatNumber(detail.result.position, config),
            },
          ]}
          actions={[
            {
              id: 'print',
              label: t('reportCard.print'),
              priority: 'primary',
              icon: <PrinterIcon />,
              onClick: () => window.print(),
            },
          ]}
        />
      </div>

      <div className="mt-6 print:mt-0">
        <PageContainer>
          <div className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5 print:rounded-none print:border-0 print:p-0 print:shadow-none">
            <ReportCard
              data={data}
              issuer={{
                name: profile.name,
                name_bn: profile.name_bn,
                address: profile.address,
                phone: profile.phone,
                email: profile.email,
                registration_id: profile.registration_id,
                logo_key: profile.logo_url ? 'active' : null,
              }}
              logoUrl={profile.logo_url}
              activeLanguage={i18n.language}
              labels={{
                examLabel: t('reportCard.examLabel'),
                rollLabel: t('reportCard.rollLabel'),
                subject: t('reportCard.subject'),
                obtained: t('reportCard.obtained'),
                grade: t('reportCard.grade'),
                gpa: t('reportCard.gpa'),
                totalMarks: t('reportCard.totalMarks'),
                totalGpa: t('reportCard.totalGpa'),
                overallGrade: t('reportCard.overallGrade'),
                position: t('reportCard.position'),
                positionValue: t('reportCard.positionValue'),
                fail: t('reportCard.fail'),
                fourthSubject: t('reportCard.fourthSubject'),
                absent: t('reportCard.absent'),
                legendTitle: t('reportCard.legendTitle'),
                programs: t('reportCard.programs'),
                progress: t('reportCard.progress'),
                latestMilestone: t('reportCard.latestMilestone'),
                scoreGrade: t('reportCard.scoreGrade'),
              }}
            />
          </div>
        </PageContainer>
      </div>
    </>
  );
}

function ReportCardPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
