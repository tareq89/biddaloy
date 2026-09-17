/**
 * [16.7.5] Student detail's "Recurring fees" top-level tab — registered
 * in `$studentId.tsx` next to "Fees" per issue #679's Step 4. Shows
 * which schedules currently cover this student, which they're excluded
 * from, and lets staff toggle either direction, plus a "Bill one-off"
 * fallback for when no schedule's audience matches this student.
 *
 * `GenerateFeesModal` (`-generate/generate-fees-modal.tsx`) has no
 * pre-selected-student prop yet (`GenerateFeesModalProps` is
 * `{ open, onOpenChange }` only) — that's [16.3.6]'s own gap, not this
 * ticket's to close, so "Bill one-off" opens it unselected rather than
 * silently doing nothing.
 */
import { Permission } from '@biddaloy/shared';
import { Button, Input } from '@biddaloy/ui/components';
import {
  useAddScheduleExclusion,
  useHasPermission,
  useIncludeStudentInSchedule,
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
      <Button
        type="button"
        size="sm"
        disabled={addExclusion.isPending}
        onClick={() =>
          addExclusion.mutate(
            { student_id: studentId, ...(reason.trim() ? { reason: reason.trim() } : {}) },
            { onSuccess: () => setPromptOpen(false) },
          )
        }
      >
        {t('recurringFeesTab.excludeAction')}
      </Button>
    </div>
  );
}

function IncludeAgainRow({ scheduleId, name }: { scheduleId: string; name: string }) {
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
        onClick={() => includeMutation.mutate(scheduleId)}
      >
        {t('recurringFeesTab.includeAction')}
      </Button>
    </li>
  );
}

export function RecurringFeesTab({ studentId }: RecurringFeesTabProps) {
  const { t } = useTranslation('fees');
  const canManage = useHasPermission(Permission.FEE_GENERATE);
  const coverageQuery = useStudentScheduleCoverage(studentId);
  const [billOneOffOpen, setBillOneOffOpen] = React.useState(false);

  return (
    <>
      <TabQueryState
        query={coverageQuery}
        forbiddenMessage={t('detail.forbidden', { ns: 'students' })}
        errorMessage={t('recurringFeesTab.errorMessage')}
      >
        {(coverage) => (
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <h2 className="text-base font-medium">{t('recurringFeesTab.includedTitle')}</h2>
              {coverage.included.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('recurringFeesTab.includedEmptyMessage')}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {coverage.included.map((schedule: RecurringSchedule) => (
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
              {coverage.excluded.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('recurringFeesTab.excludedEmptyMessage')}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {coverage.excluded.map((schedule) => (
                    <IncludeAgainRow
                      key={schedule.id}
                      scheduleId={schedule.id}
                      name={schedule.name}
                    />
                  ))}
                </ul>
              )}
            </section>

            {canManage && (
              <div className="flex items-center gap-3">
                <p className="text-sm text-muted-foreground">
                  {t('recurringFeesTab.noAudienceMatchNotice')}
                </p>
                <Button type="button" variant="outline" onClick={() => setBillOneOffOpen(true)}>
                  {t('recurringFeesTab.billOneOffAction')}
                </Button>
              </div>
            )}
          </div>
        )}
      </TabQueryState>
      {canManage && <GenerateFeesModal open={billOneOffOpen} onOpenChange={setBillOneOffOpen} />}
    </>
  );
}
