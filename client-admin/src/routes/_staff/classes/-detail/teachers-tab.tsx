import { DataTable, type DataTableColumn } from '@biddaloy/ui/components';
import { useClassTeachers, type ClassTeacher } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

export interface TeachersTabProps {
  classId: string;
}

const PAGE_SIZE = 20;

/** Read-only — teacher CRUD is #177 ([8.11.7] Manage staff/teachers), so
 * this tab only reads `GET /classes/:classId/teachers`, no add/remove
 * actions here.
 *
 * `useClassTeachers` returns the whole roster unpaginated, so `DataTable`
 * gets a local page slice — same pattern as `ImportErrorTable`, whose
 * data is also fully client-side. Renders through `DataTable` rather
 * than the raw `Table` primitive for the same reason as `StudentsTab`:
 * the plain `<table>` here had no card-mode fallback, so it was the
 * [8.14.7] responsive-reflow gap at `/classes/$classId`. */
export function TeachersTab({ classId }: TeachersTabProps) {
  const { t } = useTranslation('classes');
  // [8.14.15] Separate binding so `staff` is actually loaded before the
  // designation cell renders. Kept as its own call, not
  // `useTranslation(['classes', 'staff'])` — `check-i18n-keys.mjs`
  // resolves this file's namespace from the *first* single-quoted
  // `useTranslation('...')` call it finds, and an array argument doesn't
  // match that regex.
  useTranslation('staff');
  const query = useClassTeachers(classId);
  const [page, setPage] = React.useState(1);

  const columns: DataTableColumn<ClassTeacher>[] = [
    {
      id: 'name',
      header: t('detail.teachers.columnName'),
      accessorFn: (teacher) => teacher.full_name,
    },
    {
      id: 'employeeId',
      header: t('detail.teachers.columnEmployeeId'),
      accessorFn: (teacher) => teacher.employee_id,
    },
    {
      id: 'designations',
      header: t('detail.teachers.columnDesignations'),
      accessorFn: (teacher) =>
        teacher.designations
          .map((designation) => t(`teacherForm.designations.${designation}`, { ns: 'staff' }))
          .join(', '),
    },
    {
      id: 'sections',
      header: t('detail.teachers.columnSections'),
      accessorFn: (teacher) => teacher.section_names.join(', '),
    },
  ];

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.teachers.errorMessage')}
    >
      {(teachers) => (
        <DataTable
          tableId="class-detail-teachers"
          caption={t('detail.teachers.columnName')}
          columns={columns}
          data={teachers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
          getRowId={(teacher) => teacher.id}
          sorting={null}
          onSortingChange={() => {}}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={teachers.length}
          onPageChange={setPage}
          emptyMessage={t('detail.teachers.emptyMessage')}
        />
      )}
    </TabQueryState>
  );
}
