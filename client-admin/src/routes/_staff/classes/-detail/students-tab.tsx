import { EnrollmentStatus } from '@biddaloy/shared';
import {
  Pagination,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useStudents } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

export interface StudentsTabProps {
  classId: string;
}

const PAGE_SIZE = 20;

/** Reuses `useStudents({ class_id })` — same students endpoint
 * `students/index.tsx` filters through, not a class-scoped duplicate. */
export function StudentsTab({ classId }: StudentsTabProps) {
  const { t } = useTranslation('classes');
  const [page, setPage] = React.useState(1);
  const query = useStudents({ class_id: classId, page, limit: PAGE_SIZE });

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.students.errorMessage')}
    >
      {(students) =>
        students.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.students.emptyMessage')}</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('detail.students.columnName')}</TableHead>
                  <TableHead>{t('detail.students.columnRoll')}</TableHead>
                  <TableHead>{t('detail.students.columnSection')}</TableHead>
                  <TableHead>{t('detail.students.columnStatus')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {students.data.map((student) => (
                  <TableRow key={student.id}>
                    <TableCell>
                      <Link
                        to="/students/$studentId"
                        params={{ studentId: student.id }}
                        className="font-medium text-primary underline"
                      >
                        {student.full_name}
                      </Link>
                    </TableCell>
                    <TableCell>{student.roll_number}</TableCell>
                    <TableCell>{student.class_section.section_name}</TableCell>
                    <TableCell>
                      <StatusBadge
                        domain="enrollment"
                        status={student.enrollment_status as EnrollmentStatus}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination
              page={page}
              pageSize={PAGE_SIZE}
              totalCount={students.total}
              onPageChange={setPage}
            />
          </>
        )
      }
    </TabQueryState>
  );
}
