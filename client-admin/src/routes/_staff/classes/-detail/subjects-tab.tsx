/**
 * [9.1] Class detail page's Subjects tab — which subjects this class
 * offers in its academic year, with attach/remove for CLASS_MANAGE
 * holders. Structure mirrors `-sections-panel.tsx` (own query, own
 * create/delete dialogs), rendered through `DataTable` for the same
 * narrow-container card-mode fallback every other tab gets.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  DataTable,
  ErrorState,
  Skeleton,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useClassSubjects, useHasPermission, type ClassSubject } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { AttachSubjectDialog } from '../-attach-subject-dialog';
import { RemoveSubjectDialog } from '../-remove-subject-dialog';

export interface SubjectsTabProps {
  classId: string;
  academicYearId: string;
}

export function SubjectsTab({ classId, academicYearId }: SubjectsTabProps) {
  const { t } = useTranslation('classes');
  const { t: tCommon } = useTranslation('common');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);

  const query = useClassSubjects(classId, academicYearId);
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<ClassSubject | null>(null);
  const [page, setPage] = React.useState(1);
  const PAGE_SIZE = 20;

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <div className="p-4">
        <ErrorState
          message={forbidden ? t('detail.forbidden') : t('subjects.errorMessage')}
          retryLabel={tCommon('actions.retry')}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const classSubjects = query.data ?? [];

  const columns: DataTableColumn<ClassSubject>[] = [
    {
      id: 'name',
      header: t('subjects.columnName'),
      accessorFn: (row) => row.subject.name_en,
    },
    {
      id: 'code',
      header: t('subjects.columnCode'),
      accessorFn: (row) => row.subject.code,
    },
    {
      id: 'optional',
      header: t('subjects.columnOptional'),
      accessorFn: (row) => (row.is_optional ? t('subjects.yes') : t('subjects.no')),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('subjects.columnActions'),
            pinned: true,
            accessorFn: (row: ClassSubject) => (
              <button
                type="button"
                className="inline-flex min-h-6 min-w-6 items-center justify-center text-sm font-medium text-destructive underline"
                onClick={() => setRemoving(row)}
              >
                {t('subjects.remove')}
              </button>
            ),
          } as DataTableColumn<ClassSubject>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{t('subjects.heading')}</h2>
        {canManage && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAttachOpen(true)}>
            {t('subjects.addSubject')}
          </Button>
        )}
      </div>

      <DataTable
        tableId="class-detail-subjects"
        caption={t('subjects.columnName')}
        columns={columns}
        data={classSubjects.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={() => {}}
        page={page}
        pageSize={PAGE_SIZE}
        totalCount={classSubjects.length}
        onPageChange={setPage}
        emptyMessage={t('subjects.emptyMessage')}
      />

      {canManage && (
        <AttachSubjectDialog
          open={attachOpen}
          onOpenChange={setAttachOpen}
          classId={classId}
          academicYearId={academicYearId}
          excludeSubjectIds={classSubjects.map((row) => row.subject_id)}
          onSaved={() => setAttachOpen(false)}
        />
      )}

      {canManage && removing && (
        <RemoveSubjectDialog
          open={removing !== null}
          onOpenChange={(open) => !open && setRemoving(null)}
          classId={classId}
          academicYearId={academicYearId}
          subjectId={removing.subject_id}
          subjectName={removing.subject.name_en}
          onRemoved={() => setRemoving(null)}
        />
      )}
    </div>
  );
}
