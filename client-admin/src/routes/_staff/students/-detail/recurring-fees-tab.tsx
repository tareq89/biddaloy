/**
 * [16.7.5] Student detail's "Recurring fees" top-level tab — registered
 * in `$studentId.tsx` next to "Fees" per issue #679's Step 4. Shows
 * which schedules currently cover this student, which they're excluded
 * from, lets staff exclude/re-include them, lists active schedules not
 * currently covering them, and offers a "Bill one-off" fallback
 * (pre-selected to this student) for those.
 *
 * Note there is no per-student "add to schedule": coverage is derived
 * from the schedule's audience, and the only per-student lever the
 * server has is an exclusion (`POST`/`DELETE .../exclusions`). A prior
 * interim contract posted to a `/fees/schedules/:id/inclusions` route
 * the server never implemented — removed rather than left calling a 404.
 */
import { Permission } from '@biddaloy/shared';
import { Button, Input } from '@biddaloy/ui/components';
import {
  useAddScheduleExclusion,
  useHasPermission,
  useIncludeStudentInSchedule,
  useRecurringSchedules,
  useStudent,
  useStudentScheduleCoverage,
  type RecurringSchedule,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { GenerateFeesModal } from '../../fees/-generate/generate-fees-modal';

import { TabQueryState } from './tab-query-state';

export interface RecurringFeesTabProps {
  studentId: string;
}

function ExcludeAction({ scheduleId, studentId }: { scheduleId: string; studentId: string }) {
  const { t } = useTranslation('fees');
  const [promptOpen, setPromptOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const addExclusion = useAddScheduleExclusion(scheduleId);

  if (!promptOpen) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setPromptOpen(true)}>
        {t('recurringFeesTab.excludeAction')}
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        aria-label={t('recurringFeesTab.excludeReasonLabel')}
        placeholder={t('recurringFeesTab.excludeReasonLabel')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        className="max-w-48"
      />
      {/* `AddExclusionDto.reason` is `@IsNotEmpty()`, so an empty reason
          400s — the button stays disabled instead of round-tripping. */}
      <Button
        type="button"
        size="sm"
        disabled={addExclusion.isPending || reason.trim() === ''}
        onClick={() =>
          addExclusion.mutate(
            { student_id: studentId, reason: reason.trim() },
            { onSuccess: () => setPromptOpen(false) },
          )
        }
      >
        {t('recurringFeesTab.excludeAction')}
      </Button>
    </div>
  );
}

function IncludeAgainRow({
  scheduleId,
  studentId,
  name,
}: {
  scheduleId: string;
  studentId: string;
  name: string;
}) {
  const { t } = useTranslation('fees');
  const includeMutation = useIncludeStudentInSchedule(scheduleId);
  return (
    <li className="flex items-center justify-between rounded-lg border border-border-subtle p-3">
      <span className="text-sm">{name}</span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={includeMutation.isPending}
        onClick={() => includeMutation.mutate(studentId)}
      >
        {t('recurringFeesTab.includeAction')}
      </Button>
    </li>
  );
}

/** Does this schedule's audience already cover this student? Same three
 * fields the create/edit form's own audience fieldset writes:
 * class/section (via the student's `class_section`/`class_section_id`)
 * and the audience's `enrollment_status`, whose only accepted value is
 * `'ACTIVE'` — so an inactive student never matches any schedule's
 * audience. `Student` has no `academic_year_id` field
 * of its own on this schema, so a schedule scoped to a different
 * academic year than the student's *current* one can't be detected here
 * — a known gap, called out in the "doesn't match" copy below rather
 * than silently assumed to match. */
function audienceMatchesStudent(
  schedule: RecurringSchedule,
  student: { classId: string; sectionId: string; isActive: boolean },
): boolean {
  const matchesClass =
    !schedule.audience.class_id || schedule.audience.class_id === student.classId;
  const matchesSection =
    !schedule.audience.section_id || schedule.audience.section_id === student.sectionId;
  const matchesEnrollment = schedule.audience.enrollment_status !== 'ACTIVE' || student.isActive;
  return matchesClass && matchesSection && matchesEnrollment;
}

/** A schedule this student isn't covered by. There is no "add this one
 * student to a schedule" endpoint — schedule membership is derived from
 * the schedule's audience (class/section/`enrollment_status`), and the
 * only per-student lever the server exposes is an *exclusion*. So the
 * only real action here is the one-off bill; widening the audience is
 * done on the schedule itself. */
function AddToScheduleRow({
  schedule,
  matchesAudience,
  onBillOneOff,
}: {
  schedule: RecurringSchedule;
  matchesAudience: boolean;
  onBillOneOff: () => void;
}) {
  const { t } = useTranslation('fees');

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">{schedule.name}</span>
        <Button type="button" size="sm" variant="outline" onClick={onBillOneOff}>
          {t('recurringFeesTab.billOneOffAction')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {matchesAudience
          ? t('recurringFeesTab.alreadyCoveredNotice')
          : t('recurringFeesTab.noAudienceMatchNotice')}
      </p>
    </li>
  );
}

export function RecurringFeesTab({ studentId }: RecurringFeesTabProps) {
  const { t } = useTranslation('fees');
  const canManage = useHasPermission(Permission.SCHEDULE_MANAGE);
  const coverageQuery = useStudentScheduleCoverage(studentId);
  const studentQuery = useStudent(studentId);
  const activeSchedulesQuery = useRecurringSchedules({ is_active: true });
  const [billOneOffOpen, setBillOneOffOpen] = React.useState(false);

  const student = studentQuery.data;
  const preselectedStudent = student ? { id: student.id, name: student.full_name } : null;

  return (
    <>
      <TabQueryState
        query={coverageQuery}
        forbiddenMessage={t('detail.forbidden', { ns: 'students' })}
        errorMessage={t('recurringFeesTab.errorMessage')}
      >
        {(coverage) => {
          // `GET /students/:id/schedules` returns one flat list of the
          // schedules relevant to this student, with the ones they are
          // explicitly excluded from flagged by `excluded` — not a
          // pre-split `{ included, excluded }` object.
          const included = coverage.filter((schedule) => !schedule.excluded);
          const excluded = coverage.filter((schedule) => schedule.excluded);
          const coveredIds = new Set(coverage.map((schedule) => schedule.id));
          const addable = (activeSchedulesQuery.data ?? []).filter(
            (schedule) => !coveredIds.has(schedule.id),
          );

          return (
            <div className="flex flex-col gap-6">
              <section className="flex flex-col gap-3">
                <h2 className="text-base font-medium">{t('recurringFeesTab.includedTitle')}</h2>
                {included.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('recurringFeesTab.includedEmptyMessage')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {included.map((schedule) => (
                      <li
                        key={schedule.id}
                        className="flex items-center justify-between rounded-lg border border-border-subtle p-3"
                      >
                        <span className="text-sm">{schedule.name}</span>
                        {canManage && (
                          <ExcludeAction scheduleId={schedule.id} studentId={studentId} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="flex flex-col gap-3">
                <h2 className="text-base font-medium">{t('recurringFeesTab.excludedTitle')}</h2>
                {excluded.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {t('recurringFeesTab.excludedEmptyMessage')}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {excluded.map((schedule) =>
                      canManage ? (
                        <IncludeAgainRow
                          key={schedule.id}
                          scheduleId={schedule.id}
                          studentId={studentId}
                          name={schedule.name}
                        />
                      ) : (
                        <li
                          key={schedule.id}
                          className="flex items-center justify-between rounded-lg border border-border-subtle p-3"
                        >
                          <span className="text-sm">{schedule.name}</span>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </section>

              {canManage && (
                <section className="flex flex-col gap-3">
                  <h2 className="text-base font-medium">
                    {t('recurringFeesTab.addToScheduleTitle')}
                  </h2>
                  {addable.length === 0 || !student ? (
                    <p className="text-sm text-muted-foreground">
                      {t('recurringFeesTab.addToScheduleEmptyMessage')}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {addable.map((schedule) => (
                        <AddToScheduleRow
                          key={schedule.id}
                          schedule={schedule}
                          matchesAudience={audienceMatchesStudent(schedule, {
                            classId: student.class_section.class_id,
                            sectionId: student.class_section_id,
                            isActive: student.enrollment_status === 'ACTIVE',
                          })}
                          onBillOneOff={() => setBillOneOffOpen(true)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          );
        }}
      </TabQueryState>
      {canManage && (
        <GenerateFeesModal
          open={billOneOffOpen}
          onOpenChange={setBillOneOffOpen}
          preselectedStudent={preselectedStudent}
        />
      )}
    </>
  );
}
