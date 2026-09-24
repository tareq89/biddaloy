/**
 * [21.9.1] D11: the review screen for the current academic year's
 * routine (`Routine`'s unique `(tenant_id, academic_year_id)` index means
 * there is at most one, so no PUBLISHED/REVIEW/DRAFT ranking is needed
 * once scoped to the year — same year-scoping `ResolveRoutineService`
 * already does server-side). No per-class routine picker exists yet,
 * same one-active-routine assumption `$sectionId.tsx` makes when it
 * can't find a section-scoped one.
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
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@biddaloy/ui/components';
import {
  useAcademicYears,
  useChangeRequests,
  useCopyRoutineYear,
  useCurrentUserId,
  useHasPermission,
  usePeriodSlotLookup,
  useRoutines,
  useRoutineSlots,
  useSubjects,
  useSubmitForReview,
  useTeachers,
  useWithdrawRoutine,
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

function RoutineReviewPage() {
  const { t } = useTranslation('routines');
  const canManage = useHasPermission(Permission.ROUTINE_MANAGE);
  const currentUserId = useCurrentUserId();

  const academicYearsQuery = useAcademicYears({});
  const currentYearId = academicYearsQuery.data?.data.find((year) => year.is_current)?.id;
  const routinesQuery = useRoutines();
  const routine = routinesQuery.data?.find(
    (candidate) => candidate.academic_year_id === currentYearId,
  );
  const slotsQuery = useRoutineSlots(routine?.id);
  const changeRequestsQuery = useChangeRequests(canManage ? routine?.id : undefined);
  const subjectsQuery = useSubjects({});
  const teachersQuery = useTeachers({});
  const ownTeacherQuery = useTeachers(
    currentUserId ? { user_id: currentUserId, limit: 1 } : { limit: 1 },
  );
  const periodLookupQuery = usePeriodSlotLookup();

  const submitForReview = useSubmitForReview(routine?.id ?? '');
  const withdraw = useWithdrawRoutine(routine?.id ?? '');
  const copyYear = useCopyRoutineYear(routine?.id ?? '');
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [changeRequestSlotId, setChangeRequestSlotId] = React.useState<string | null>(null);
  const [copyYearOpen, setCopyYearOpen] = React.useState(false);
  const [targetAcademicYearId, setTargetAcademicYearId] = React.useState('');

  if (routinesQuery.isPending || academicYearsQuery.isPending) return null;

  if (!routine) {
    return <p className="p-4 text-sm text-muted-foreground">{t('review.noRoutineExplanation')}</p>;
  }

  const ownTeacher = ownTeacherQuery.data?.data.find(
    (teacher) => teacher.user.id === currentUserId,
  );
  const subjectName = (id: string) =>
    subjectsQuery.data?.data.find((subject) => subject.id === id)?.name_en ?? id;
  // Weekday + subject alone can't tell two same-day periods of the same
  // subject apart — same gap `-substitution-dialog.tsx` fixed for its own
  // slot picker, using the same period lookup.
  const slotLabel = (slot: { weekday: number; period_slot_id: string; subject_id: string }) => {
    const period = periodLookupQuery.data?.[slot.period_slot_id];
    const parts = [t(`grid.weekday.${WEEKDAY_KEYS[slot.weekday]}`)];
    if (period)
      parts.push(`${t('agenda.periodLabel', { sequence: period.sequence })} (${period.starts_at})`);
    parts.push(subjectName(slot.subject_id));
    return parts.join(' · ');
  };

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
              <Button
                type="button"
                variant="outline"
                loading={submitForReview.isPending}
                onClick={handleSubmitForReview}
              >
                {t('review.submitForReviewAction')}
              </Button>
            )}
            {routine.state === 'REVIEW' && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  loading={withdraw.isPending}
                  onClick={handleWithdraw}
                >
                  {t('review.withdrawAction')}
                </Button>
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
            <span>{slotLabel(entry.slot)}</span>
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
            return entry ? slotLabel(entry.slot) : slotId;
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

      <Dialog open={copyYearOpen} onOpenChange={setCopyYearOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('review.copyYearDialogTitle')}</DialogTitle>
            <DialogDescription>{t('review.copyYearDialogExplanation')}</DialogDescription>
          </DialogHeader>

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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setCopyYearOpen(false)}>
              {t('review.copyYearCancel')}
            </Button>
            <Button
              type="button"
              disabled={!targetAcademicYearId}
              loading={copyYear.isPending}
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
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
