/**
 * [19.7.1] Marks-entry landing page. Pick an exam, see the outstanding
 * (DRAFT) section-subject grids you may enter — the server already scopes
 * `MARK_ENTER` via `TeacherClassSection` (19.4.1's `marks-authorization
 * .util.ts`), so a teacher only ever sees grids they're allowed to write.
 * An admin (EXAM_MANAGE) additionally gets a section/subject text filter
 * since their list spans the whole school.
 *
 * NOTE (reported to parent as a plan divergence): the issue's "own
 * subjects first" ordering needs a signal this page has no cheap access
 * to (which section-subjects the signed-in teacher personally teaches) —
 * `useExamProgress`'s `outstanding` list carries no such flag. This ships
 * in the order the server returns (section name, ASC) rather than
 * inventing a second endpoint call; a follow-up ticket can add that
 * ordering once a "my sections" hook exists.
 */
import { Permission } from '@biddaloy/shared';
import {
  ErrorState,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import { examsQueryOptions, useExamProgress, useExams, useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/marks/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(examsQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'common'),
    ]),
  pendingComponent: MarksListPending,
  component: MarksListPage,
});

function MarksListPage() {
  const { t } = useTranslation('exams');
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const examsQuery = useExams({ limit: 50 });
  const exams = examsQuery.data?.data ?? [];

  const [examId, setExamId] = React.useState<string | undefined>(undefined);
  const [sectionFilter, setSectionFilter] = React.useState('');
  const selectedExamId = examId ?? exams[0]?.id;

  const progressQuery = useExamProgress(selectedExamId);

  const outstanding = (progressQuery.data?.outstanding ?? []).filter(
    (row) => row.state === 'DRAFT' && (!sectionFilter || row.section_name.includes(sectionFilter)),
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{t('marksList.title')}</h1>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={selectedExamId ?? ''} onValueChange={setExamId}>
          <SelectTrigger aria-label={t('marksList.examLabel')}>
            <SelectValue placeholder={t('marksList.examPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {exams.map((exam) => (
              <SelectItem key={exam.id} value={exam.id}>
                {exam.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canManage && (
          <input
            type="text"
            value={sectionFilter}
            onChange={(event) => setSectionFilter(event.target.value)}
            placeholder={t('marksList.columnSection')}
            aria-label={t('marksList.columnSection')}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          />
        )}
      </div>

      {!selectedExamId ? (
        <p className="text-sm text-muted-foreground">{t('marksList.selectExamHint')}</p>
      ) : progressQuery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : progressQuery.isError ? (
        <ErrorState
          message={t('marksList.loadError')}
          onRetry={() => void progressQuery.refetch()}
        />
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('marksList.tableCaption')}</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">{t('marksList.columnSection')}</th>
              <th className="py-2">{t('marksList.columnState')}</th>
            </tr>
          </thead>
          <tbody>
            {outstanding.map((row) => (
              <tr key={`${row.section_id}:${row.subject_id}`} className="border-b">
                <td className="py-2">
                  <Link
                    to="/marks/$examId/$sectionId/$subjectId"
                    params={{
                      examId: selectedExamId,
                      sectionId: row.section_id,
                      subjectId: row.subject_id,
                    }}
                    className="font-medium text-primary underline"
                  >
                    {row.section_name}
                  </Link>
                </td>
                <td className="py-2">{t('marksList.stateDraft')}</td>
              </tr>
            ))}
            {outstanding.length === 0 && (
              <tr>
                <td colSpan={2} className="py-4 text-center text-muted-foreground">
                  {t('marksList.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function MarksListPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
