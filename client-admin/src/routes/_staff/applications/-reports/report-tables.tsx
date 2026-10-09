/** [52.5.4] The report's tables and the two "on leave today" lists. All read-only. */
import { APPLICATION_TYPES, type ApplicationType } from '@biddaloy/shared';
import { Card, DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { APPLICATION_STATUS_TONE, stepLabel, type ApplicationReportsDto } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatMonth, formatNumber } from '@biddaloy/ui/utils';

type Report = ApplicationReportsDto;
interface TableProps<T> {
  rows: T[] | undefined;
  loading: boolean;
}

const noSort = { sorting: null, onSortingChange: () => {} } as const;

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div>
        <h2 className="text-h3">{title}</h2>
        {hint && <p className="text-caption text-text-secondary">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

const DAY_MS = 86_400_000;

export function StalePendingTable({ rows, loading }: TableProps<Report['stale_pending'][number]>) {
  const { t } = useTranslation('applicationsReports');
  const { t: tApp } = useTranslation('applications');
  const config = useRegionConfig();
  type Row = Report['stale_pending'][number];
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'serial',
      header: t('colNumber'),
      // Serials stay Latin digits (A8): rendered as text, never through formatNumber.
      accessorFn: (r) => r.serial,
      card: 'title',
    },
    {
      id: 'since',
      header: t('colSubmitted'),
      accessorFn: (r) =>
        `${formatDate(r.created_at, config)} · ${t('waitingDays', {
          n: formatNumber(Math.floor((Date.now() - Date.parse(r.created_at)) / DAY_MS), config),
        })}`,
      card: 'subtitle',
    },
    { id: 'type', header: t('colType'), accessorFn: (r) => tApp(`types.${r.type}`) },
    { id: 'applicant', header: t('colApplicant'), accessorFn: (r) => r.applicant_name ?? '—' },
    {
      id: 'step',
      header: t('colStep'),
      accessorFn: (r) =>
        stepLabel(
          {
            type: r.type,
            current_step: r.current_step,
            step_count: APPLICATION_TYPES[r.type as ApplicationType].steps.length,
            addressee_name: null,
          },
          (key, options) => tApp(key, options as never) as unknown as string,
          config,
        ),
    },
    {
      id: 'status',
      header: t('colStatus'),
      // The DTO carries no status: everything here is still waiting.
      accessorFn: () => (
        <StatusBadge tone={APPLICATION_STATUS_TONE.PENDING} label={tApp('statuses.PENDING')} />
      ),
      card: 'badge',
    },
  ];
  return (
    <Section title={t('staleTitle')}>
      {rows?.length === 0 ? (
        <p className="text-body text-text-secondary">{t('staleEmpty')}</p>
      ) : (
        <DataTable
          tableId="applications-report-stale"
          caption={t('staleTitle')}
          columns={columns}
          data={rows ?? []}
          getRowId={(r) => r.id}
          {...noSort}
          totalCount={rows?.length ?? 0}
          paginated={false}
          loading={loading}
          rowActions={(r) => [
            {
              intent: 'view',
              label: t('viewApplication', { serial: r.serial }),
              to: `/applications/${r.id}`,
            },
          ]}
        />
      )}
    </Section>
  );
}

function LeaveCard({
  title,
  items,
}: {
  title: string;
  items: { key: string; primary: string; secondary: string; until: string }[] | undefined;
}) {
  const { t } = useTranslation('applicationsReports');
  const config = useRegionConfig();
  return (
    <Card padded className="flex flex-col gap-2">
      <h3 className="text-h4 flex items-baseline justify-between">
        {title}
        <span className="text-text-secondary tabular-nums">
          {items ? formatNumber(items.length, config) : ''}
        </span>
      </h3>
      {items?.length === 0 ? (
        <p className="text-body text-text-secondary">{t('onLeaveEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {(items ?? []).map((i) => (
            <li key={i.key} className="flex min-h-11 flex-col justify-center py-1">
              <span className="text-body">{i.primary}</span>
              <span className="text-caption text-text-secondary">
                {i.secondary} · {i.until}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function OnLeaveToday({ data }: { data: Report['on_leave_today'] | undefined }) {
  const { t } = useTranslation('applicationsReports');
  const { t: tLeave } = useTranslation('leave');
  const config = useRegionConfig();
  const until = (end: string) => t('until', { date: formatDate(end, config) });
  return (
    <Section title={t('onLeaveTitle')}>
      <div className="grid gap-4 md:grid-cols-2">
        <LeaveCard
          title={t('onLeaveStaff')}
          items={data?.staff.map((s) => ({
            key: s.staff_profile_id,
            primary: s.name,
            secondary: tLeave(`type.${s.leave_type}`, { defaultValue: s.leave_type }),
            until: until(s.end_date),
          }))}
        />
        <LeaveCard
          title={t('onLeaveStudents')}
          items={data?.students.map((s) => ({
            key: s.student_id,
            primary: s.name,
            secondary: `${s.class_name} · ${s.section_name}`,
            until: until(s.end_date),
          }))}
        />
      </div>
    </Section>
  );
}

interface PivotRow {
  type: string;
  pending: number;
  approved: number;
  rejected: number;
  other: number;
}

export function TypeStatusTable({ rows, loading }: TableProps<Report['by_type_status'][number]>) {
  const { t } = useTranslation('applicationsReports');
  const { t: tApp } = useTranslation('applications');
  const config = useRegionConfig();
  const pivot = new Map<string, PivotRow>();
  for (const r of rows ?? []) {
    const row = pivot.get(r.type) ?? {
      type: r.type,
      pending: 0,
      approved: 0,
      rejected: 0,
      other: 0,
    };
    const bucket =
      r.status === 'PENDING' || r.status === 'UNDER_CONSIDERATION'
        ? 'pending'
        : r.status === 'APPROVED'
          ? 'approved'
          : r.status === 'REJECTED'
            ? 'rejected'
            : 'other';
    row[bucket] += r.count;
    pivot.set(r.type, row);
  }
  const n = (v: number) => formatNumber(v, config);
  const columns: DataTableColumn<PivotRow>[] = [
    { id: 'type', header: t('colType'), accessorFn: (r) => tApp(`types.${r.type}`), card: 'title' },
    ...(
      [
        ['pending', t('col_pending')],
        ['approved', t('col_approved')],
        ['rejected', t('col_rejected')],
        ['other', t('col_other')],
      ] as const
    ).map(([k, header]): DataTableColumn<PivotRow> => ({
      id: k,
      header,
      accessorFn: (r) => n(r[k]),
      align: 'end',
    })),
  ];
  return (
    <Section title={t('typeTitle')}>
      <DataTable
        tableId="applications-report-types"
        caption={t('typeTitle')}
        columns={columns}
        data={[...pivot.values()]}
        getRowId={(r) => r.type}
        {...noSort}
        totalCount={pivot.size}
        paginated={false}
        loading={loading}
      />
    </Section>
  );
}

export function MonthTable({ rows, loading }: TableProps<Report['by_month'][number]>) {
  const { t } = useTranslation('applicationsReports');
  const config = useRegionConfig();
  type Row = Report['by_month'][number];
  const num = (
    id: keyof Pick<Row, 'submitted' | 'approved' | 'rejected'>,
    header: string,
  ): DataTableColumn<Row> => ({
    id,
    header,
    accessorFn: (r) => formatNumber(r[id], config),
    align: 'end',
  });
  const columns: DataTableColumn<Row>[] = [
    {
      id: 'month',
      header: t('colMonth'),
      accessorFn: (r) => formatMonth(r.month, config),
      card: 'title',
    },
    num('submitted', t('col_submitted')),
    num('approved', t('col_approved')),
    num('rejected', t('col_rejected')),
  ];
  return (
    <Section title={t('monthTitle')}>
      <DataTable
        tableId="applications-report-months"
        caption={t('monthTitle')}
        columns={columns}
        data={rows ?? []}
        getRowId={(r) => r.month}
        {...noSort}
        totalCount={rows?.length ?? 0}
        paginated={false}
        loading={loading}
      />
    </Section>
  );
}

export function StaffLeaveTable({ rows, loading }: TableProps<Report['staff_leave_days'][number]>) {
  const { t } = useTranslation('applicationsReports');
  const { t: tLeave } = useTranslation('leave');
  const config = useRegionConfig();
  type Row = Report['staff_leave_days'][number];
  const columns: DataTableColumn<Row>[] = [
    { id: 'name', header: t('colStaff'), accessorFn: (r) => r.name, card: 'title' },
    {
      id: 'byType',
      header: t('colByType'),
      accessorFn: (r) =>
        Object.entries(r.by_type)
          .map(([k, v]) => `${tLeave(`type.${k}`, { defaultValue: k })} ${formatNumber(v, config)}`)
          .join(' · '),
      card: 'subtitle',
    },
    {
      id: 'total',
      header: t('colTotalDays'),
      accessorFn: (r) =>
        formatNumber(
          Object.values(r.by_type).reduce((a, b) => a + b, 0),
          config,
        ),
      align: 'end',
    },
  ];
  return (
    <Section title={t('leaveDaysTitle')} hint={t('leaveDaysHint')}>
      <DataTable
        tableId="applications-report-leave-days"
        caption={t('leaveDaysTitle')}
        columns={columns}
        data={rows ?? []}
        getRowId={(r) => r.staff_profile_id}
        {...noSort}
        totalCount={rows?.length ?? 0}
        paginated={false}
        loading={loading}
      />
    </Section>
  );
}
