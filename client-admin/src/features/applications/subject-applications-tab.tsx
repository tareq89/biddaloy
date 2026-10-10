/**
 * [52.5.2] "আবেদন" tab body for the student and staff detail pages: every application filed for
 * one subject, newest first (`view=all`, so the viewer needs `APPLICATION_MANAGE`; the callers
 * gate the tab on it). Read-only — a row opens the application page.
 */
import { ApplicationStatus } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
  type RowAction,
} from '@biddaloy/ui/components';
import {
  APPLICATION_STATUS_TONE,
  useApplications,
  type ApplicationFilters,
  type ApplicationListItemDto,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { InboxIcon, PlusIcon } from 'lucide-react';

import { summarize } from '../../routes/_staff/applications/-list/application-summary';

export type ApplicationSubject =
  | { kind: 'STUDENT'; studentId: string }
  /** `userId` feeds `/applications/new?staff=`, which takes the staff member's user id. */
  | { kind: 'STAFF'; staffProfileId: string; userId: string };

export interface SubjectApplicationsTabProps {
  subject: ApplicationSubject;
  subjectName: string;
  /** The namespace that holds `detail.applicationsTab.*` (same keys in both). */
  ns: 'students' | 'staff';
}

/** A student has a handful of applications; no pager in a tab. */
const LIMIT = 100;

export function SubjectApplicationsTab({ subject, subjectName, ns }: SubjectApplicationsTabProps) {
  // The keys are identical in both namespaces; two literal hooks keep `check:i18n` able to read them.
  const { t: tStudents } = useTranslation('students');
  const { t: tStaff } = useTranslation('staff');
  const { t: tApp } = useTranslation('applications');
  const { t: tList } = useTranslation('applicationsList');
  const config = useRegionConfig();
  const t = (ns === 'staff' ? tStaff : tStudents) as unknown as (
    key: string,
    options?: Record<string, unknown>,
  ) => string;

  const filters: ApplicationFilters =
    subject.kind === 'STUDENT'
      ? { view: 'all', student_id: subject.studentId, page: 1, limit: LIMIT }
      : { view: 'all', staff_profile_id: subject.staffProfileId, page: 1, limit: LIMIT };
  const query = useApplications(filters);

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('detail.applicationsTab.loading')}</span>
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('detail.applicationsTab.error')}
        retryLabel={t('actions.retry', { ns: 'common' })}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const { data: rows, total } = query.data;
  const newSearch =
    subject.kind === 'STUDENT' ? { student: subject.studentId } : { staff: subject.userId };

  const columns: DataTableColumn<ApplicationListItemDto>[] = [
    {
      id: 'serial',
      header: tList('columns.serial', { ns: 'applicationsList' }),
      card: 'title',
      accessorFn: (row) => (
        <span className="block">
          <span className="font-medium tabular-nums">{row.serial}</span>
          <span className="block text-caption text-muted-foreground">
            {formatDate(row.created_at, config)}
          </span>
        </span>
      ),
    },
    {
      id: 'typeSubject',
      header: t('detail.applicationsTab.typeAndSubject'),
      card: 'subtitle',
      accessorFn: (row) => (
        <span className="block">
          <span className="font-medium">{tApp(`types.${row.type}`)}</span>
          <span className="block text-caption text-muted-foreground">
            {summarize(row, tApp as never, config)}
          </span>
        </span>
      ),
    },
    {
      id: 'applicant',
      header: tList('columns.applicant', { ns: 'applicationsList' }),
      accessorFn: (row) => {
        const role = row.applicant_role ? tStaff(`roles.${row.applicant_role}`) : '';
        const caption = [role, row.source === 'PAPER' ? t('detail.applicationsTab.paper') : '']
          .filter(Boolean)
          .join(' · ');
        return (
          <span className="block">
            <span className="font-medium">{row.applicant_name}</span>
            {caption && <span className="block text-caption text-muted-foreground">{caption}</span>}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: tList('columns.status', { ns: 'applicationsList' }),
      card: 'badge',
      accessorFn: (row) => (
        <span>
          <StatusBadge
            tone={APPLICATION_STATUS_TONE[row.status as ApplicationStatus]}
            label={tApp(`statuses.${row.status}`)}
          />
        </span>
      ),
    },
  ];

  const rowActions = (row: ApplicationListItemDto): RowAction[] => [
    {
      intent: 'view',
      label: t('detail.applicationsTab.viewLabel', {
        type: tApp(`types.${row.type}`),
        serial: row.serial,
      }),
      to: `/applications/${row.id}`,
      'data-focus-anchor': row.id,
    },
  ];

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-h2">{t('detail.applicationsTab.title')}</h2>
          <p className="text-text-secondary">
            {t('detail.applicationsTab.subtitle', { name: subjectName })}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/applications/new" search={newSearch}>
            <PlusIcon aria-hidden="true" />
            {t('detail.applicationsTab.newPaper')}
          </Link>
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<InboxIcon aria-hidden="true" />}
          title={t('detail.applicationsTab.empty')}
          explanation={t('detail.applicationsTab.emptyExplanation')}
        />
      ) : (
        <>
          <DataTable
            tableId={`applications-${subject.kind.toLowerCase()}`}
            caption={t('detail.applicationsTab.title')}
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            rowActions={rowActions}
            sorting={null}
            onSortingChange={() => undefined}
            paginated={false}
            totalCount={total}
          />
          {/* ponytail: no pager in a tab; a student has a handful. Past the cap, the full list. */}
          {total > rows.length && (
            <Link
              to="/applications"
              search={{ view: 'all', q: subjectName }}
              className="text-primary underline"
            >
              {t('detail.applicationsTab.seeAll')}
            </Link>
          )}
        </>
      )}
    </section>
  );
}
