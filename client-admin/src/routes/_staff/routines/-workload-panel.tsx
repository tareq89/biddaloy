/**
 * [21.8.1] Periods-per-week per teacher for this routine (`GET /routines/
 * :id/workload`), highlighting over-limit teachers against `TenantSettings
 * .routine.maxPeriodsPerTeacherPerDay` (a per-*day* cap — a teacher is
 * "over" here if any single day in `periods_per_day` exceeds it) and
 * calling out teachers with zero periods as underloaded. This is what
 * makes D9's non-blocking warnings actionable: the grid's warning
 * highlight says "something's off", this panel says who and why.
 */
import { Skeleton } from '@biddaloy/ui/components';
import { useTeachers, useWorkload, type TeacherWorkload } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface WorkloadPanelProps {
  routineId: string | undefined;
  maxPeriodsPerTeacherPerDay?: number | null | undefined;
}

function isOverLimit(entry: TeacherWorkload, cap: number | null | undefined): boolean {
  if (!cap) return false;
  return Object.values(entry.periods_per_day).some((count) => count > cap);
}

export function WorkloadPanel({ routineId, maxPeriodsPerTeacherPerDay }: WorkloadPanelProps) {
  const { t } = useTranslation('routines');
  const workloadQuery = useWorkload(routineId);
  const teachersQuery = useTeachers({});

  const teacherName = (teacherId: string) =>
    teachersQuery.data?.data.find((teacher) => teacher.id === teacherId)?.user.full_name ??
    teacherId;

  if (workloadQuery.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  const entries = workloadQuery.data ?? [];
  const underloaded = entries.filter((entry) => entry.periods_per_week === 0);

  return (
    <section aria-label={t('workloadPanel.legend')} className="flex flex-col gap-2">
      <h2 className="text-base font-medium">{t('workloadPanel.legend')}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('workloadPanel.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {entries.map((entry) => {
            const overLimit = isOverLimit(entry, maxPeriodsPerTeacherPerDay);
            return (
              <li
                key={entry.teacher_id}
                className={`flex items-center justify-between rounded-md border px-3 py-1.5 ${
                  overLimit
                    ? 'border-status-overdue-fg bg-status-overdue-bg text-status-overdue-fg'
                    : 'border-border-subtle'
                }`}
              >
                <span>{teacherName(entry.teacher_id)}</span>
                <span>
                  {t('workloadPanel.periodsPerWeek', { count: entry.periods_per_week })}
                  {overLimit && ` · ${t('workloadPanel.overLimit')}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {underloaded.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {t('workloadPanel.underloaded', { count: underloaded.length })}
        </p>
      )}
    </section>
  );
}
