/**
 * [19.8.1] The exam detail's Results tab — per-student rows (total, GPA,
 * grade, position, fail flag), sortable, filterable by fail. Sorting and the
 * fail filter are local (`useResults` already returns the whole class in one
 * call, position-ordered — no pagination to preserve across a sort change).
 *
 * The status actions (process / publish / SMS / reopen) live in the exam
 * header. `/results` has no exam header, so it passes `examStatus` and the
 * panel draws the same actions as a toolbar from `useResultActions`.
 */
import {
  Button,
  Checkbox,
  DataTable,
  ErrorState,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import { useResults } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { Ellipsis } from 'lucide-react';
import * as React from 'react';

import { useResultActions } from './use-result-actions';

export interface ResultsPanelProps {
  examId: string;
  /** Present on `/results` only: draws the status toolbar. Omitted on the exam detail. */
  examStatus?: string | undefined;
}

type SortColumn = 'position' | 'total_marks' | 'gpa' | 'grade' | 'full_name';
const SORT_COLUMNS: readonly string[] = ['position', 'total_marks', 'gpa', 'grade', 'full_name'];

export function ResultsPanel({ examId, examStatus }: ResultsPanelProps) {
  const { t } = useTranslation('exams');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();
  const resultsQuery = useResults(examId);
  const { actions, dialogs } = useResultActions(examId, examStatus);
  const [sortColumn, setSortColumn] = React.useState<SortColumn>('position');
  const [sortDesc, setSortDesc] = React.useState(false);
  const [failOnly, setFailOnly] = React.useState(false);

  const rows = resultsQuery.data ?? [];
  const filtered = failOnly ? rows.filter((r) => r.is_fail) : rows;
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortColumn];
    const bv = b[sortColumn];
    // Rows with no value (e.g. no position yet) sort last in BOTH
    // directions — only real values flip when the order is reversed.
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    const cmp =
      typeof av === 'string' || typeof bv === 'string'
        ? String(av).localeCompare(String(bv))
        : av - bv;
    return sortDesc ? -cmp : cmp;
  });

  if (resultsQuery.isLoading) return <Skeleton className="h-32 w-full" />;
  if (resultsQuery.isError)
    return (
      <ErrorState
        message={t('resultsPanel.loadError')}
        onRetry={() => void resultsQuery.refetch()}
      />
    );

  const allowed = actions.filter((a) => a.allowed !== false);
  const secondary = allowed.filter((a) => (a.priority ?? 'secondary') === 'secondary');
  const primary = allowed.find((a) => a.priority === 'primary');
  const destructive = allowed.filter((a) => a.priority === 'destructive');

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col-reverse gap-3 md:flex-row md:items-center md:justify-between">
        <label className="flex min-h-11 items-center gap-3 md:min-h-8">
          <Checkbox checked={failOnly} onCheckedChange={(v) => setFailOnly(v === true)} />
          {t('resultsPanel.failFilter')}
        </label>

        {allowed.length > 0 && (
          <div className="flex items-center gap-2">
            {secondary.map((a) => (
              <Button
                key={a.id}
                type="button"
                variant="outline"
                className="hidden md:inline-flex"
                onClick={a.onClick}
              >
                {a.icon}
                {a.label}
              </Button>
            ))}
            {primary && (
              <Button type="button" className="flex-1 md:flex-none" onClick={primary.onClick}>
                {primary.icon}
                {primary.label}
              </Button>
            )}
            {(secondary.length > 0 || destructive.length > 0) && (
              <Menu>
                <MenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    iconOnly
                    aria-label={tCommon('actions.moreActions')}
                    className={destructive.length === 0 ? 'md:hidden' : ''}
                  >
                    <Ellipsis />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  {secondary.map((a) => (
                    <MenuItem
                      key={a.id}
                      className="md:hidden"
                      {...(a.onClick && { onSelect: a.onClick })}
                    >
                      {a.icon}
                      {a.label}
                    </MenuItem>
                  ))}
                  {destructive.length > 0 && secondary.length > 0 && <MenuSeparator />}
                  {destructive.map((a) => (
                    <MenuItem
                      key={a.id}
                      variant="destructive"
                      className="text-destructive"
                      {...(a.onClick && { onSelect: a.onClick })}
                    >
                      {a.icon}
                      {a.label}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            )}
          </div>
        )}
      </div>

      <DataTable
        tableId="exam-results"
        caption={t('resultsPanel.tableCaption')}
        paginated={false}
        columns={[
          {
            id: 'position',
            header: t('resultsPanel.columnPosition'),
            accessorFn: (row) => formatNumber(row.position, config),
            sortable: true,
            align: 'end',
          },
          {
            id: 'full_name',
            header: t('resultsPanel.columnStudent'),
            accessorFn: (row) => (
              <Link
                to="/results/$examId/$studentId"
                params={{ examId, studentId: row.student_id }}
                className="font-medium hover:text-primary"
              >
                {t('resultsPanel.rollName', {
                  roll: formatNumber(row.roll_number, config),
                  name: row.full_name,
                })}
              </Link>
            ),
            sortable: true,
            card: 'title',
          },
          {
            id: 'total_marks',
            header: t('resultsPanel.columnTotal'),
            accessorFn: (row) => formatNumber(row.total_marks, config),
            sortable: true,
            align: 'end',
          },
          {
            id: 'gpa',
            header: t('resultsPanel.columnGpa'),
            accessorFn: (row) => formatNumber(row.gpa, config, { decimals: 2 }),
            sortable: true,
            align: 'end',
          },
          {
            id: 'grade',
            header: t('resultsPanel.columnGrade'),
            accessorFn: (row) => row.grade,
            sortable: true,
          },
          {
            id: 'status',
            header: t('resultsPanel.columnStatus'),
            accessorFn: (row) => (
              <StatusBadge
                tone={row.is_fail ? 'danger' : 'success'}
                label={row.is_fail ? t('resultsPanel.fail') : t('resultsPanel.pass')}
              />
            ),
            card: 'badge',
          },
        ]}
        data={sorted}
        getRowId={(row) => row.student_id}
        sorting={{ id: sortColumn, desc: sortDesc }}
        onSortingChange={(next) => {
          if (next && SORT_COLUMNS.includes(next.id)) {
            // A newly picked column always starts ascending (the table would
            // start non-text columns descending); a second click flips it.
            setSortDesc(next.id === sortColumn ? next.desc : false);
            setSortColumn(next.id as SortColumn);
          } else {
            setSortColumn('position');
            setSortDesc(false);
          }
        }}
        page={1}
        pageSize={Math.max(sorted.length, 1)}
        totalCount={sorted.length}
        onPageChange={() => {}}
        emptyState={{
          title: t('resultsPanel.emptyTitle'),
          explanation: t('resultsPanel.empty'),
        }}
      />

      {dialogs}
    </div>
  );
}
