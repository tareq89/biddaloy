/**
 * [19.8.1] step 5: the printable report card. Fetches the student's
 * result detail, the grading scale it was computed against (for the
 * legend — `useGradingScale(result.grading_scale_id)`, not duplicated
 * server-side, see `ResultsService.getStudentResult`'s own comment), and
 * the school's own profile for the header (`IssuerHeader`, D6).
 */
import {
  Button,
  ErrorState,
  ReportCard,
  RoutePending,
  Skeleton,
  type ReportCardData,
} from '@biddaloy/ui/components';
import { useExam, useGradingScale, useResultDetail, useSchoolProfile } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/results/$examId/$studentId')({
  loader: () => loadRouteNamespaces('exams', 'common'),
  pendingComponent: ReportCardPending,
  component: ReportCardPage,
});

function ReportCardPage() {
  const { examId, studentId } = Route.useParams();
  const { t, i18n } = useTranslation('exams');
  const examQuery = useExam(examId);
  const detailQuery = useResultDetail(examId, studentId);
  const scaleQuery = useGradingScale(detailQuery.data?.result.grading_scale_id);
  const profileQuery = useSchoolProfile();

  const isLoading = examQuery.isPending || detailQuery.isPending || profileQuery.isPending;
  const isError = examQuery.isError || detailQuery.isError || profileQuery.isError;

  if (isLoading) return <Skeleton className="h-96 w-full" />;
  if (isError || !examQuery.data || !detailQuery.data || !profileQuery.data) {
    return (
      <ErrorState
        message={t('reportCard.loadError')}
        onRetry={() => {
          void examQuery.refetch();
          void detailQuery.refetch();
        }}
      />
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
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link to="/exams/$examId" params={{ examId }} className="text-sm text-primary underline">
          {t('reportCard.back')}
        </Link>
        <Button type="button" onClick={() => window.print()}>
          {t('reportCard.print')}
        </Button>
      </div>

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
        }}
      />
    </div>
  );
}

function ReportCardPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
