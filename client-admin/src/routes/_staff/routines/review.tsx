/**
 * [21.9.1] D11: the review screen for the tenant's current routine —
 * whichever one is `PUBLISHED`, else the most recently created `REVIEW`,
 * else the most recently created `DRAFT` (this codebase has no per-class
 * routine picker yet, same one-active-routine assumption `$sectionId.tsx`
 * makes when it can't find a section-scoped one).
 *
 * Two audiences share this page:
 * - `ROUTINE_MANAGE` holders (ADMIN/EXECUTIVE) see every slot, the state
 *   controls (submit for review / withdraw / publish) and the change
 *   request queue.
 * - Everyone else (a teacher) sees only their own slots and can request a
 *   change on a published one — the server only accepts a change request
 *   against a `PUBLISHED` slot (`ChangeRequestsService.open`), so the
 *   action is disabled with an explanation otherwise, not just left to
 *   fail server-side.
 *
 * The state banner is the acceptance criterion made literal: it always
 * says, in words, who can see the routine right now.
 */
import { Permission } from '@biddaloy/shared';
import { toast } from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useChangeRequests,
  useCopyRoutineYear,
  useCurrentUserId,
  useHasPermission,
  useRoutines,
  useRoutineSlots,
  useSubjects,
  useSubmitForReview,
  useTeachers,
  useWithdrawRoutine,
  type Routine,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ChangeRequestDialog } from './-change-request-dialog';
import { ChangeRequestList } from './-change-request-list';
import { PublishDialog } from './-publish-dialog';

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export const Route = createFileRoute('/_staff/routines/review')({
  loader: () => loadRouteNamespaces('routines', 'common'),
  component: RoutineReviewPage,
});

/** `PUBLISHED` > `REVIEW` > `DRAFT`, most recent first within a state —
 * the one routine everyone in this ticket's flows means by "the current
 * routine" when there is no explicit selection. */
function pickCurrentRoutine(routines: Routine[] | undefined): Routine | undefined {
  if (!routines || routines.length === 0) return undefined;
  const rank: Record<Routine['state'], number> = { PUBLISHED: 0, REVIEW: 1, DRAFT: 2 };
  return [...routines].sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
    return a.created_at < b.created_at ? 1 : -1;
  })[0];
}

function RoutineReviewPage() {
  const { t } = useTranslation('routines');
  const canManage = useHasPermission(Permission.ROUTINE_MANAGE);
  const currentUserId = useCurrentUserId();

  const routinesQuery = useRoutines();
  const routine = pickCurrentRoutine(routinesQuery.data);
  const slotsQuery = useRoutineSlots(routine?.id);
  const changeRequestsQuery = useChangeRequests(canManage ? routine?.id : undefined);
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});

  const submitForReview = useSubmitForReview(routine?.id ?? '');
  const withdraw = useWithdrawRoutine(routine?.id ?? '');
  const copyYear = useCopyRoutineYear(routine?.id ?? '');
  const academicYearsQuery = useAcademicYears({});
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [changeRequestSlotId, setChangeRequestSlotId] = React.useState<string | null>(null);
  const [copyYearOpen, setCopyYearOpen] = React.useState(false);
  const [targetAcademicYearId, setTargetAcademicYearId] = React.useState('');

  if (routinesQuery.isPending) return null;

  if (!routine) {
    return <p className="p-4 text-sm text-muted-foreground">{t('review.noRoutineExplanation')}</p>;
  }

  const ownTeacher = teachersQuery.data?.data.find((teacher) => teacher.user.id === currentUserId);
  const subjectName = (id: string) =>
    subjectsQuery.data?.data.find((subject) => subject.id === id)?.name_en ?? id;

  const allSlots = slotsQuery.data ?? [];
  const visibleSlots = canManage
    ? allSlots
    : allSlots.filter((entry) => (ownTeacher ? entry.teacher_ids.includes(ownTeacher.id) : false));

  const bannerKey =
    routine.state === 'DRAFT'
      ? 'review.banner.draft'
      : routine.state === 'REVIEW'
        ? 'review.banner.review'
        : 'review.banner.published';

  function handleSubmitForReview() {
    submitForReview.mutate(undefined, {
      onSuccess: () => toast.success(t('review.stateChangedToast')),
      onError: () => toast.error(t('review.stateChangeErrorToast')),
    });
  }

  function handleWithdraw() {
    withdraw.mutate(undefined, {
      onSuccess: () => toast.success(t('review.stateChangedToast')),
      onError: () => toast.error(t('review.stateChangeErrorToast')),
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{t('review.title')}</h1>
        {canManage && (
          <div className="flex gap-2">
            <button
              type="button"
              className="h-9 rounded-md border border-border-subtle px-3 text-sm"
              onClick={() => setCopyYearOpen(true)}
            >
              {t('review.copyYearAction')}
            </button>
            {routine.state === 'DRAFT' && (
              <button
                type="button"
                className="h-9 rounded-md border border-border-subtle px-3 text-sm"
                onClick={handleSubmitForReview}
              >
                {t('review.submitForReviewAction')}
              </button>
            )}
            {routine.state === 'REVIEW' && (
              <>
                <button
                  type="button"
                  className="h-9 rounded-md border border-border-subtle px-3 text-sm"
                  onClick={handleWithdraw}
                >
                  {t('review.withdrawAction')}
                </button>
                <button
                  type="button"
                  className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground"
                  onClick={() => setPublishOpen(true)}
                >
                  {t('review.publishAction')}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div
        role="status"
        className="flex items-center gap-2 rounded-md border-2 border-primary bg-muted p-3 text-sm font-medium"
      >
        <span className="rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground uppercase">
          {t(`review.stateLabel.${routine.state}`)}
        </span>
        <span>{t(bannerKey)}</span>
      </div>

      {!canManage && !ownTeacher && (
        <p className="text-sm text-muted-foreground">{t('review.notATeacherExplanation')}</p>
      )}

      {visibleSlots.length === 0 && !slotsQuery.isPending && (
        <p className="text-sm text-muted-foreground">{t('review.emptyExplanation')}</p>
      )}

      <ul className="flex flex-col gap-2">
        {visibleSlots.map((entry) => (
          <li
            key={entry.slot.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-card px-4 py-2"
          >
            <span>
              <span className="font-medium">
                {t(`grid.weekday.${WEEKDAY_KEYS[entry.slot.weekday]}`)}
              </span>{' '}
              · {subjectName(entry.slot.subject_id)}
            </span>
            {!canManage && ownTeacher && (
              <button
                type="button"
                className="h-8 rounded-md border border-border-subtle px-2.5 text-sm disabled:opacity-50"
                disabled={routine.state !== 'PUBLISHED'}
                title={
                  routine.state !== 'PUBLISHED'
                    ? t('review.requestChangeDisabledExplanation')
                    : undefined
                }
                onClick={() => setChangeRequestSlotId(entry.slot.id)}
              >
                {t('review.requestChangeAction')}
              </button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <ChangeRequestList
          requests={changeRequestsQuery.data ?? []}
          routineId={routine.id}
          slotLabel={(slotId) => {
            const entry = allSlots.find((candidate) => candidate.slot.id === slotId);
            return entry ? subjectName(entry.slot.subject_id) : slotId;
          }}
          requesterLabel={(userId) =>
            teachersQuery.data?.data.find((teacher) => teacher.user.id === userId)?.user
              .full_name ?? userId
          }
        />
      )}

      {changeRequestSlotId && (
        <ChangeRequestDialog
          open
          onOpenChange={(open) => !open && setChangeRequestSlotId(null)}
          routineId={routine.id}
          slotId={changeRequestSlotId}
          onDone={() => setChangeRequestSlotId(null)}
        />
      )}

      <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} routineId={routine.id} />

      {copyYearOpen && (
        <div
          role="dialog"
          aria-label={t('review.copyYearAction')}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="flex w-full max-w-sm flex-col gap-3 rounded-lg border border-border-subtle bg-card p-4">
            <h2 className="text-sm font-semibold">{t('review.copyYearDialogTitle')}</h2>
            <p className="text-sm text-muted-foreground">{t('review.copyYearDialogExplanation')}</p>
            <label className="flex flex-col gap-1 text-sm">
              {t('review.copyYearTargetLabel')}
              <select
                className="h-9 rounded-md border border-input bg-card px-2.5 text-sm"
                value={targetAcademicYearId}
                onChange={(event) => setTargetAcademicYearId(event.target.value)}
              >
                <option value="">{t('review.copyYearSelectTarget')}</option>
                {(academicYearsQuery.data?.data ?? []).map((year) => (
                  <option key={year.id} value={year.id}>
                    {year.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="h-9 rounded-md px-3 text-sm"
                onClick={() => setCopyYearOpen(false)}
              >
                {t('review.copyYearCancel')}
              </button>
              <button
                type="button"
                disabled={!targetAcademicYearId || copyYear.isPending}
                className="h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
                onClick={() =>
                  copyYear.mutate(
                    { target_academic_year_id: targetAcademicYearId },
                    {
                      onSuccess: (result) => {
                        toast.success(
                          t('review.copyYearSuccessToast', { count: result.skipped_slot_count }),
                        );
                        setCopyYearOpen(false);
                      },
                      onError: () => toast.error(t('review.copyYearErrorToast')),
                    },
                  )
                }
              >
                {t('review.copyYearConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
