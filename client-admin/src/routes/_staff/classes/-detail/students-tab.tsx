import { EnrollmentStatus } from '@biddaloy/shared';
import { DataTable, StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { useStudents, type Student } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';
import { GraduationCapIcon } from 'lucide-react';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

export interface StudentsTabProps {
  classId: string;
}

const PAGE_SIZE = 25;

/** Reuses `useStudents({ class_id })` — the same students endpoint
 * `students/index.tsx` filters through, not a class-scoped duplicate.
 *
 * Renders through `DataTable` rather than the raw `Table` primitive so
 * this list gets the same card-mode fallback at narrow container widths
 * as every other list — a plain `<table>` here was the [8.14.7]
 * responsive-reflow gap (`/classes/$classId` failed `no horizontal
 * scroll at 320px` since the tab strip has far less room than a
 * full-page list). */
export function StudentsTab({ classId }: StudentsTabProps) {
  const { t } = useTranslation('classes');
  const regionConfig = useTenantRegionConfig();
  const [page, setPage] = React.useState(1);
  const query = useStudents({ class_id: classId, page, limit: PAGE_SIZE });

  const columns: DataTableColumn<Student>[] = [
    {
      id: 'name',
      header: t('detail.students.columnName'),
      accessorFn: (student) => (
        <Link
          to="/students/$studentId"
          params={{ studentId: student.id }}
          className="font-medium text-text-primary hover:text-primary"
        >
          {student.full_name}
        </Link>
      ),
    },
    {
      id: 'roll',
      header: t('detail.students.columnRoll'),
      accessorFn: (student) =>
        student.roll_number == null ? '—' : formatNumber(student.roll_number, regionConfig),
      align: 'end',
    },
    {
      id: 'section',
      header: t('detail.students.columnSection'),
      accessorFn: (student) => student.class_section.section_name,
    },
    {
      id: 'status',
      header: t('detail.students.columnStatus'),
      accessorFn: (student) => (
        <StatusBadge domain="enrollment" status={student.enrollment_status as EnrollmentStatus} />
      ),
    },
  ];

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.students.errorMessage')}
    >
      {(students) => (
        <DataTable
          tableId="class-detail-students"
          caption={t('detail.students.columnName')}
          columns={columns}
          data={students.data}
          getRowId={(student) => student.id}
          sorting={null}
          onSortingChange={() => {}}
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={students.total}
          onPageChange={setPage}
          rowActions={(student) => [
            { intent: 'view', label: t('detail.students.view'), to: `/students/${student.id}` },
          ]}
          emptyState={{
            icon: <GraduationCapIcon aria-hidden="true" />,
            title: t('detail.students.emptyMessage'),
            explanation: t('detail.students.emptyExplanation'),
          }}
        />
      )}
    </TabQueryState>
  );
}
