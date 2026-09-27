/**
 * [29.0 / #1026] Staff detail's Teaching assignments tab — the
 * teacher-centric mirror of `classes/-detail/teachers-tab.tsx`: instead of
 * one section's roster, this lists one teacher's assignments across every
 * class/section, via `useTeacherAssignments(teacherId)`
 * (`ui/src/hooks/teachers.ts`). A `DataTable` (not the per-section panel
 * layout `teachers-tab.tsx` uses) because rows here already carry their own
 * class/section columns — nothing to group by.
 *
 * Assign/remove reuse `-assign-teacher-dialog.tsx` and the unbound
 * `useAssignTeacherAssignment`/`useUnassignTeacherAssignment` hooks from
 * `ui/src/hooks/classes.ts` (the `#1026` gap fix) — this screen has no
 * fixed class/section to bind them to, unlike `teachers-tab.tsx`.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from '@biddaloy/ui/components';
import {
  useHasPermission,
  useTeacherAssignments,
  useUnassignTeacherAssignment,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { AssignTeacherDialog } from '../../classes/-assign-teacher-dialog';

import { TabQueryState } from './tab-query-state';

export interface TeachingAssignmentsTabProps {
  teacherId: string;
}

export function TeachingAssignmentsTab({ teacherId }: TeachingAssignmentsTabProps) {
  const { t } = useTranslation('staff');
  const canManage = useHasPermission(Permission.CLASS_MANAGE);
  const query = useTeacherAssignments(teacherId);
  const unassign = useUnassignTeacherAssignment();
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [sorting, setSorting] = React.useState<DataTableSort | null>(null);

  const columns: DataTableColumn<NonNullable<typeof query.data>[number]>[] = [
    {
      id: 'class',
      header: t('detail.teachingAssignments.columnClass'),
      accessorFn: (row) => row.class_name,
    },
    {
      id: 'section',
      header: t('detail.teachingAssignments.columnSection'),
      accessorFn: (row) => row.section_name,
    },
    {
      id: 'role',
      header: t('detail.teachingAssignments.columnRole'),
      accessorFn: (row) =>
        row.subject_id
          ? t('teacherForm.designations.SUBJECT_TEACHER')
          : t('teacherForm.designations.CLASS_TEACHER'),
    },
    {
      id: 'subject',
      header: t('detail.teachingAssignments.columnSubject'),
      accessorFn: (row) => row.subject_name ?? '—',
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: t('detail.teachingAssignments.columnActions'),
            pinned: true,
            accessorFn: (row) => (
              <button
                type="button"
                className="min-h-6 min-w-6 text-sm font-medium text-destructive underline disabled:opacity-50"
                disabled={unassign.isPending && unassign.variables?.assignmentId === row.id}
                onClick={() =>
                  unassign.mutate({
                    classId: row.class_id,
                    sectionId: row.section_id,
                    assignmentId: row.id,
                  })
                }
              >
                {t('detail.teachingAssignments.remove')}
              </button>
            ),
          } satisfies DataTableColumn<NonNullable<typeof query.data>[number]>,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <Button type="button" onClick={() => setAssignOpen(true)} className="self-start">
          {t('detail.teachingAssignments.assign')}
        </Button>
      )}

      {unassign.isError && (
        <p role="alert" className="text-sm text-destructive">
          {t('detail.teachingAssignments.removeError')}
        </p>
      )}

      <TabQueryState
        query={query}
        forbiddenMessage={t('detail.forbidden')}
        errorMessage={t('detail.teachingAssignments.errorMessage')}
      >
        {(rows) => (
          <DataTable
            tableId="staff-teaching-assignments"
            caption={t('detail.teachingAssignments.caption')}
            columns={columns}
            data={rows}
            getRowId={(row) => row.id}
            sorting={sorting}
            onSortingChange={setSorting}
            page={1}
            pageSize={Math.max(rows.length, 1)}
            totalCount={rows.length}
            onPageChange={() => {}}
            emptyMessage={t('detail.teachingAssignments.emptyMessage')}
            announceResults={(count, total) =>
              t('detail.teachingAssignments.announceResults', { count, total })
            }
          />
        )}
      </TabQueryState>

      {canManage && (
        <AssignTeacherDialog
          open={assignOpen}
          onOpenChange={setAssignOpen}
          teacherId={teacherId}
          onAssigned={() => setAssignOpen(false)}
        />
      )}
    </div>
  );
}
