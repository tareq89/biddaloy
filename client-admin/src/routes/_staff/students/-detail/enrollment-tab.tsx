import { EnrollmentStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useHasPermission, useStudentEnrollments } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { TransferDialog } from './-transfer-dialog';
import { TabQueryState } from './tab-query-state';

export interface EnrollmentTabProps {
  studentId: string;
  studentName: string;
}

export function EnrollmentTab({ studentId, studentName }: EnrollmentTabProps) {
  const { t } = useTranslation('students');
  const query = useStudentEnrollments(studentId);
  const canUpdate = useHasPermission(Permission.STUDENT_UPDATE);
  const [moveDialogOpen, setMoveDialogOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-4">
      {canUpdate && (
        // Shown even when the history table below is empty — a legacy
        // student who predates [8.11.3]'s day-one enrollment write is
        // exactly who needs the "get-or-create" POST fallback, not just
        // students that already have history rows.
        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={() => setMoveDialogOpen(true)}>
            {t('detail.enrollment.moveClassAction')}
          </Button>
        </div>
      )}

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
                    <TableCell>
                      {enrollment.section?.section_name ?? t('list.emptyValue')}
                    </TableCell>
                    <TableCell>{enrollment.academic_year.name}</TableCell>
                    <TableCell>
                      {/* `schema.d.ts` types this as a string-literal union,
                          not the real `EnrollmentStatus` enum — same cast
                          $studentId.tsx's header badge already uses for
                          Student.enrollment_status. */}
                      <StatusBadge
                        domain="enrollment"
                        status={enrollment.enrollment_status as EnrollmentStatus}
                      />
                    </TableCell>
                    <TableCell>{enrollment.enrolled_at}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        }
      </TabQueryState>

      <TransferDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        studentId={studentId}
        studentName={studentName}
      />
    </div>
  );
}
