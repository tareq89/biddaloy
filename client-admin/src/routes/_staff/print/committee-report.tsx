/**
 * [8.10.7.5.07] `/print/committee-report`: the committee's monthly meeting report, one
 * A4-friendly page printed with the browser's own dialog (`window.print()`), the way
 * `attendance/register.tsx` does it. D48: "this month, as of today" — it reads the same four
 * aggregate endpoints the dashboard cards read, through the same hooks and table helpers, so
 * the page and the cards cannot disagree. Totals only (D44): nothing here names a person.
 */
import { Button, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatMonth,
  formatNumber,
  formatServerAmount,
  tenantTodayIso,
} from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';
import { z } from 'zod';

import {
  committeeAttendanceTable,
  useCommitteeAttendance,
} from '../../../dashboard/widgets/committee/committee-attendance.widget';
import {
  type CommitteeTable,
  committeeEnrollmentTable,
  useCommitteeEnrollment,
} from '../../../dashboard/widgets/committee/committee-enrollment.widget';
import {
  committeeFinanceTable,
  useCommitteeFinance,
} from '../../../dashboard/widgets/committee/committee-finance.widget';
import {
  committeePassRateTable,
  useCommitteePassRate,
} from '../../../dashboard/widgets/committee/committee-pass-rate.widget';
import { buildCommitteeSummary } from '../../../dashboard/widgets/committee/committee-summary';
import { loadRouteNamespaces } from '../../../route-loaders';
import { useActiveSchoolName } from '../../../use-active-school-name';
import './-committee-report-print.css';

export const Route = createFileRoute('/_staff/print/committee-report')({
  staticData: { chromeless: true },
  validateSearch: z.object({
    // An in-app path only: never navigate to an address typed into the URL.
    from: z
      .string()
      .regex(/^\/(?![/\\])/)
      .optional()
      .catch(undefined),
  }),
  loader: () => loadRouteNamespaces('dashboard', 'common'),
  component: CommitteeReportPage,
});

function ReportTable({ table }: { table: CommitteeTable }) {
  return (
    <table className="w-full border-collapse text-body">
      <caption className="sr-only">{table.caption}</caption>
      <thead>
        <tr>
          {table.columns.map((c, i) => (
            <th
              key={c}
              scope="col"
              className={`border-b border-border py-1 font-medium ${table.numeric[i] ? 'text-right' : 'text-left'}`}
            >
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r) => (
          <tr key={r.join('|')}>
            {r.map((cell, i) => (
              <td
                key={`${i}-${cell}`}
                className={`border-b border-border py-1 ${table.numeric[i] ? 'text-right tabular-nums' : 'text-left'}`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReportShell({ busy, children }: { busy?: boolean; children: React.ReactNode }) {
  return (
    <main aria-busy={busy} className="committee-report p-4">
      <PageContainer size="narrow">{children}</PageContainer>
    </main>
  );
}

function CommitteeReportPage() {
  const { t } = useTranslation('dashboard');
  const region = useTenantRegionConfig();
  const school = useActiveSchoolName();
  const search = Route.useSearch();
  const enrollment = useCommitteeEnrollment();
  const attendance = useCommitteeAttendance();
  const finance = useCommitteeFinance();
  const passRate = useCommitteePassRate();
  const queries = [enrollment, attendance, finance, passRate];

  const tr = (key: string, opts: Record<string, unknown> = {}) => t(`committeeReport.${key}`, opts);
  const tw = (widget: string, key: string, opts: Record<string, unknown> = {}) =>
    t(`widgets.${widget}.${key}`, opts);
  const pct = (v: number) => `${formatNumber(v, region)}%`;
  const today = tenantTodayIso(region);
  // `from` is an in-app path checked by the schema, not a typed route.
  const back = (search.from ?? '/dashboard') as '/dashboard';
  // Kept at the same place (first child of a <header>) in every state, so React reuses the
  // node: route focus lands on it while loading, and a new <h1> would drop that focus.
  const heading = <h1 className="text-h2 font-semibold">{tr('title')}</h1>;

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Button
        className="min-h-11"
        disabled={queries.some((q) => q.isPending || q.isError)}
        onClick={() => window.print()}
      >
        <PrinterIcon aria-hidden="true" />
        {tr('print')}
      </Button>
      <Button asChild variant="outline" className="min-h-11">
        <Link to={back}>{tr('back')}</Link>
      </Button>
    </div>
  );

  if (queries.some((q) => q.isError)) {
    return (
      <ReportShell>
        <header className="flex flex-col gap-1">{heading}</header>
        {toolbar}
        <ErrorState
          message={tr('loadError')}
          retryLabel={t('states.retry')}
          onRetry={() => queries.forEach((q) => void q.refetch())}
        />
      </ReportShell>
    );
  }

  if (queries.some((q) => q.isPending)) {
    return (
      <ReportShell busy>
        <header className="flex flex-col gap-1">{heading}</header>
        {toolbar}
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </ReportShell>
    );
  }

  const [e, a, f, p] = [enrollment.data!, attendance.data!, finance.data!, passRate.data!];
  const summary = buildCommitteeSummary(a, f, t, region);
  const keyNumbers: [string, string][] = [
    [tw('committee-enrollment', 'tileLabel'), formatNumber(e.current_count, region)],
    [
      tw('committee-attendance', 'tileLabel'),
      a.current_month_percentage == null ? '—' : pct(a.current_month_percentage),
    ],
    [
      tw('committee-finance', 'tileLabel'),
      f.current_month.received_pct == null ? '—' : pct(f.current_month.received_pct),
    ],
    [
      tw('committee-pass-rate', 'tileLabel'),
      p.overall_pass_percentage == null ? '—' : pct(p.overall_pass_percentage),
    ],
  ];

  const sections: {
    id: string;
    heading: string;
    empty: string | null;
    table: CommitteeTable;
    note?: string;
  }[] = [
    {
      id: 'enrollment',
      heading: tr('sectionEnrollment'),
      empty: e.years.length === 0 ? tw('committee-enrollment', 'emptyReason') : null,
      table: committeeEnrollmentTable(e, t, region),
    },
    {
      id: 'attendance',
      heading: tr('sectionAttendance'),
      empty: a.months.every((m) => m.percentage == null)
        ? tw('committee-attendance', 'emptyReason')
        : null,
      table: committeeAttendanceTable(a, t, region),
      note: tw('committee-attendance', 'targetLine', {
        target: `${formatNumber(a.target_percentage, region, { decimals: 1 })}%`,
      }),
    },
    {
      id: 'finance',
      heading: tr('sectionFinance'),
      empty: f.months.length === 0 ? tw('committee-finance', 'emptyReason') : null,
      table: committeeFinanceTable(f, t, region),
      note: `${formatServerAmount(f.year_outstanding, region)} ${tw('committee-finance', 'valueUnit')}`,
    },
    {
      id: 'pass-rate',
      heading: tr('sectionPassRate'),
      empty:
        p.exam_name === null || p.classes.length === 0
          ? tw('committee-pass-rate', 'emptyReason')
          : null,
      table: committeePassRateTable(p, t, region),
      ...(p.overall_pass_percentage == null
        ? {}
        : {
            note: tw('committee-pass-rate', 'average', {
              percent: `${formatNumber(p.overall_pass_percentage, region, { decimals: 1 })}%`,
            }),
          }),
    },
  ];

  return (
    <ReportShell>
      <header className="flex flex-col gap-1">
        {heading}
        <p className="text-body-lg">
          {tr('subtitle', { school, month: formatMonth(today, region) })}
        </p>
        <p className="text-caption text-text-secondary">
          {tr('asOf', { date: formatDate(today, region) })}
        </p>
      </header>
      {toolbar}
      {summary ? <p className="text-body-lg">{summary}</p> : null}

      <section aria-label={tr('keyNumbers')} className="flex flex-col gap-2">
        <p className="font-medium">{tr('keyNumbers')}</p>
        <dl className="grid grid-cols-2 gap-3">
          {keyNumbers.map(([label, value]) => (
            <div key={label} className="rounded-md border border-border p-3">
              <dt className="text-caption text-text-secondary">{label}</dt>
              <dd className="text-h3 font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {sections.map((s) => (
        <section key={s.id} aria-labelledby={`cr-${s.id}`} className="flex flex-col gap-2">
          <h2 id={`cr-${s.id}`} className="text-h3 font-semibold">
            {s.heading}
          </h2>
          {s.empty ? (
            <p>{s.empty}</p>
          ) : (
            <>
              <ReportTable table={s.table} />
              {s.note ? <p className="text-caption">{s.note}</p> : null}
            </>
          )}
        </section>
      ))}

      <footer className="border-t border-border pt-2 text-caption text-text-secondary">
        {tr('footer')}
      </footer>
    </ReportShell>
  );
}
