import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useStudentEnrollments } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { TabQueryState } from './tab-query-state';

export interface EnrollmentTabProps {
  studentId: string;
}

export function EnrollmentTab({ studentId }: EnrollmentTabProps) {
  const { t } = useTranslation('students');
  const query = useStudentEnrollments(studentId);

  return (
    <TabQueryState
      query={query}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.enrollment.errorMessage')}
    >
      {(enrollments) =>
        enrollments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('detail.enrollment.emptyMessage')}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('detail.enrollment.columnClass')}</TableHead>
                <TableHead>{t('detail.enrollment.columnSection')}</TableHead>
                <TableHead>{t('detail.enrollment.columnAcademicYear')}</TableHead>
                <TableHead>{t('detail.enrollment.columnStatus')}</TableHead>
                <TableHead>{t('detail.enrollment.columnEnrolledAt')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {enrollments.map((enrollment) => (
                <TableRow key={enrollment.id}>
                  <TableCell>{enrollment.class.name}</TableCell>
                  <TableCell>{enrollment.section?.section_name ?? t('list.emptyValue')}</TableCell>
                  <TableCell>{enrollment.academic_year.name}</TableCell>
                  <TableCell>{enrollment.enrollment_status}</TableCell>
                  <TableCell>{enrollment.enrolled_at}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      }
    </TabQueryState>
  );
}
