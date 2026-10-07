import { EnrollmentStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  DataTable,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useHasPermission,
  useStudentEnrollments,
  useStudentPromotionOverrides,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { ArrowRightLeftIcon, InfoIcon } from 'lucide-react';
import * as React from 'react';

import { TransferDialog } from './-transfer-dialog';
import { TabQueryState } from './tab-query-state';

export interface EnrollmentTabProps {
  studentId: string;
  studentName: string;
  /** The student's status. A student who has left gets no move/transfer action: the server
   * refuses a new enrollment for them (409); bringing them back is "Readmit" in the header. */
  enrollmentStatus: string;
}

export function EnrollmentTab({ studentId, studentName, enrollmentStatus }: EnrollmentTabProps) {
  const { t } = useTranslation('students');
  const { t: tPromotions } = useTranslation('promotions');
  const regionConfig = useRegionConfig();
  const query = useStudentEnrollments(studentId);
  const overridesQuery = useStudentPromotionOverrides(studentId);
  const canUpdate = useHasPermission(Permission.STUDENT_UPDATE) && enrollmentStatus === 'ACTIVE';
  const [moveDialogOpen, setMoveDialogOpen] = React.useState(false);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 p-4 md:px-5">
        <h2 className="text-h2">{t('detail.enrollment.title')}</h2>
        {canUpdate && (
          // Shown even when the history table below is empty — a legacy
          // student who predates [8.11.3]'s day-one enrollment write is
          // exactly who needs the "get-or-create" POST fallback, not just
          // students that already have history rows.
          <Button type="button" variant="outline" onClick={() => setMoveDialogOpen(true)}>
            <ArrowRightLeftIcon className="size-4" aria-hidden />
            {t('detail.enrollment.moveClassAction')}
          </Button>
        )}
      </div>

      <TabQueryState
        query={query}
        forbiddenMessage={t('detail.forbidden')}
        errorMessage={t('detail.enrollment.errorMessage')}
      >
        {(enrollments) => {
          type Row = (typeof enrollments)[number];
          // [26.5.2] D12: one override can match several enrollments only if a
          // student was promoted/retained more than once into the same target
          // year, which doesn't happen in practice — matching on year name is
          // enough, and it's the only field `findStudentOverrides` gives us.
          const overrideOf = (enrollment: Row) =>
            overridesQuery.data?.find(
              (o) => o.target_academic_year_name === enrollment.academic_year.name,
            );
          const sorted = [...enrollments].sort((a, b) =>
            b.enrolled_at.localeCompare(a.enrolled_at),
          );
          const columns: DataTableColumn<Row>[] = [
            {
              id: 'academicYear',
              header: t('detail.enrollment.columnAcademicYear'),
              accessorFn: (enrollment) => {
                const override = overrideOf(enrollment);
                return (
                  <span>
                    {enrollment.academic_year.name}
                    {override && (
                      <span className="mt-1 flex items-start gap-1 text-caption text-status-due-fg">
                        <InfoIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {tPromotions(`badge.${override.final_outcome.toLowerCase()}`, {
                          year: override.target_academic_year_name ?? '',
                          note: override.override_note ?? '',
                          user: override.overridden_by_name ?? '',
                        })}
                      </span>
                    )}
                  </span>
                );
              },
              card: 'title',
            },
            {
              id: 'class',
              header: t('detail.enrollment.columnClass'),
              accessorFn: (enrollment) =>
                t('detail.enrollment.classValue', {
                  class: enrollment.class.name,
                  section: enrollment.section?.section_name ?? t('list.emptyValue'),
                }),
              card: 'subtitle',
            },
            {
              id: 'status',
              header: t('detail.enrollment.columnStatus'),
              // `schema.d.ts` types this as a string-literal union, not the
              // real `EnrollmentStatus` enum — same cast the header badge uses.
              accessorFn: (enrollment) => (
                <StatusBadge
                  domain="enrollment"
                  status={enrollment.enrollment_status as EnrollmentStatus}
                />
              ),
              card: 'badge',
            },
            {
              id: 'enrolledAt',
              header: t('detail.enrollment.columnEnrolledAt'),
              accessorFn: (enrollment) =>
                formatDate(parseServerDate(enrollment.enrolled_at), regionConfig),
            },
          ];
          return (
            <DataTable
              tableId="student-enrollments"
              caption={t('detail.enrollment.title')}
              paginated={false}
              sorting={null}
              onSortingChange={() => {}}
              columns={columns}
              data={sorted}
              getRowId={(enrollment) => enrollment.id}
              totalCount={sorted.length}
              emptyState={{
                title: t('detail.enrollment.emptyMessage'),
                explanation: t('detail.enrollment.emptyExplanation'),
              }}
            />
          );
        }}
      </TabQueryState>

      <TransferDialog
        open={moveDialogOpen}
        onOpenChange={setMoveDialogOpen}
        studentId={studentId}
        studentName={studentName}
      />
    </Card>
  );
}
