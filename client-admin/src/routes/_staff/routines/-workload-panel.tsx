/**
 * [21.8.1] Periods-per-week per teacher for this routine (`GET /routines/
 * :id/workload`), flagging over-limit teachers against `TenantSettings
 * .routine.maxPeriodsPerTeacherPerDay` (a per-*day* cap — a teacher is
 * "over" here if any single day in `periods_per_day` exceeds it) and
 * calling out teachers with zero periods as underloaded. This is what
 * makes D9's non-blocking warnings actionable: the grid's warning
 * highlight says "something's off", this panel says who and why.
 *
 * [31.4] A Card with a kit `DataTable`; the over-limit state is a danger
 * `StatusBadge` rather than a tinted row.
 */
import { Card, DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { useTeachers, useWorkload, type TeacherWorkload } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

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
  const config = useRegionConfig();
  const workloadQuery = useWorkload(routineId);
  const teachersQuery = useTeachers({});

  const teacherName = (teacherId: string) =>
    teachersQuery.data?.data.find((teacher) => teacher.id === teacherId)?.user.full_name ?? '—';

  const entries = workloadQuery.data ?? [];
  const underloaded = entries.filter((entry) => entry.periods_per_week === 0);

  const columns: DataTableColumn<TeacherWorkload>[] = [
    {
      id: 'teacher',
      header: t('workloadPanel.teacherColumn'),
      accessorFn: (entry) => (
        <>
          <span className="font-medium">{teacherName(entry.teacher_id)}</span>
          <span className="block text-caption text-text-secondary md:hidden">
            {t('workloadPanel.periodsPerWeekShort', {
              count: formatNumber(entry.periods_per_week, config),
            })}
          </span>
        </>
      ),
    },
    {
      id: 'periods',
      header: t('workloadPanel.periodsColumn'),
      align: 'end',
      card: 'hidden',
      accessorFn: (entry) => formatNumber(entry.periods_per_week, config),
    },
    {
      id: 'status',
      header: t('workloadPanel.statusColumn'),
      accessorFn: (entry) =>
        isOverLimit(entry, maxPeriodsPerTeacherPerDay) ? (
          <StatusBadge tone="danger" label={t('workloadPanel.overLimit')} />
        ) : (
          '—'
        ),
    },
  ];

  return (
    <Card padded={false} className="overflow-hidden">
      <section aria-label={t('workloadPanel.legend')}>
        <div className="p-4 md:p-5">
          <h2 className="text-h2">{t('workloadPanel.legend')}</h2>
          {underloaded.length > 0 && (
            <p className="mt-1 text-text-secondary">
              {t('workloadPanel.underloaded', { count: underloaded.length })}
            </p>
          )}
        </div>
        {!workloadQuery.isPending && entries.length === 0 ? (
          <p className="px-4 pb-4 text-text-secondary">{t('workloadPanel.empty')}</p>
        ) : (
          <DataTable
            tableId="routine-workload"
            caption={t('workloadPanel.legend')}
            columns={columns}
            data={entries}
            getRowId={(entry) => entry.teacher_id}
            sorting={null}
            onSortingChange={() => {}}
            paginated={false}
            totalCount={entries.length}
            loading={workloadQuery.isPending}
          />
        )}
      </section>
    </Card>
  );
}
