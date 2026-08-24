import { EnrollmentStatus, Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import { useHasPermission, useStudent } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { ActivityTab } from './-detail/activity-tab';
import { CommunicationTab } from './-detail/communication-tab';
import { DeleteStudentDialog } from './-detail/delete-student-dialog';
import { EnrollmentTab } from './-detail/enrollment-tab';
import { FeesTab } from './-detail/fees-tab';
import { GuardiansTab } from './-detail/guardians-tab';
import { InvoicesTab } from './-detail/invoices-tab';
import { OverviewTab } from './-detail/overview-tab';
import { PaymentsTab } from './-detail/payments-tab';
import { TransferStatusDialog } from './-detail/transfer-status-dialog';
import { SendReminderDialog } from './-send-reminder-dialog';

const studentDetailSearchSchema = z.object({
  // `useDetailShellTab` falls back to the first tab for anything not in
  // its own `tabIds` list, so an invalid value here isn't validated away
  // by this schema — it's handled once, there, not duplicated here.
  tab: z.string().optional(),
});

/**
 * [8.10.2] — one page for a student's enrolment history, fees, payments,
 * invoices, guardians and message history, replacing [8.9.1]'s
 * name-only stub. Eight tabs (`DetailShell`/`useDetailShellTab`, both
 * already built for this), each its own component below so each one's
 * data query only ever runs once its tab is first activated — opening
 * this page fires exactly one request (`useStudent`, shared by the
 * header and the default-active Overview tab), not eight.
 */
export const Route = createFileRoute('/_staff/students/$studentId')({
  validateSearch: studentDetailSearchSchema,
  component: StudentDetailPage,
});

const TAB_IDS = [
  'overview',
  'enrollment',
  'fees',
  'payments',
  'invoices',
  'guardians',
  'communication',
  'activity',
] as const;

function StudentDetailPage() {
  const { studentId } = Route.useParams();
  const { t } = useTranslation('students');
  const navigate = useNavigate();
  const studentQuery = useStudent(studentId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);

  const [reminderDialogOpen, setReminderDialogOpen] = React.useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

  const canUpdate = useHasPermission(Permission.STUDENT_UPDATE);
  const canDelete = useHasPermission(Permission.STUDENT_DELETE);
  const canCollectFees = useHasPermission(Permission.FEE_COLLECT);
  const canSendReminder = useHasPermission(Permission.COMMUNICATION_BULK_SEND);
  // The Fees/Payments/Invoices tabs format currency — same reasoning as
  // `/settings`'s own `RegionConfigProvider` wrap: `useRegionConfig()`
  // has no ambient provider above the route tree, so without this every
  // amount on this page would silently fall back to the context's
  // hardcoded default region rather than the active tenant's actual one.
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        <Link to="/students" className="text-sm text-primary underline">
          {t('detail.back')}
        </Link>

        {studentQuery.isPending ? (
          <Skeleton className="h-7 w-64" />
        ) : studentQuery.isError ? (
          <ErrorState
            message={
              studentQuery.error instanceof ApiError && studentQuery.error.statusCode === 403
                ? t('detail.forbidden')
                : t('detail.loadError')
            }
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void studentQuery.refetch()}
          />
        ) : (
          <>
            <DetailShell
              name={studentQuery.data.full_name}
              identifiers={t('detail.identifiers', {
                registrationNumber: studentQuery.data.registration_number,
                className: studentQuery.data.class_section.class.name,
                roll: studentQuery.data.roll_number,
              })}
              statusBadge={
                <StatusBadge
                  domain="enrollment"
                  status={studentQuery.data.enrollment_status as EnrollmentStatus}
                />
              }
              actions={[
                {
                  id: 'edit',
                  label: t('detail.actions.edit'),
                  allowed: canUpdate,
                  onClick: () =>
                    void navigate({ to: '/students/$studentId/edit', params: { studentId } }),
                },
                {
                  id: 'collect-fees',
                  label: t('detail.actions.collectFees'),
                  allowed: canCollectFees,
                  onClick: () =>
                    void navigate({ to: '/payments/record', search: { student_id: studentId } }),
                },
                {
                  id: 'send-reminder',
                  label: t('detail.actions.sendReminder'),
                  allowed: canSendReminder,
                  onClick: () => setReminderDialogOpen(true),
                },
                {
                  id: 'transfer-status',
                  label: t('detail.actions.transferStatus'),
                  allowed: canUpdate,
                  onClick: () => setTransferDialogOpen(true),
                },
                {
                  id: 'delete',
                  label: t('detail.actions.delete'),
                  allowed: canDelete,
                  variant: 'destructive',
                  onClick: () => setDeleteDialogOpen(true),
                },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              tabs={[
                {
                  id: 'overview',
                  label: t('detail.tabs.overview'),
                  content: <OverviewTab studentId={studentId} />,
                },
                {
                  id: 'enrollment',
                  label: t('detail.tabs.enrollment'),
                  content: (
                    <EnrollmentTab
                      studentId={studentId}
                      studentName={studentQuery.data.full_name}
                    />
                  ),
                },
                {
                  id: 'fees',
                  label: t('detail.tabs.fees'),
                  content: <FeesTab studentId={studentId} />,
                },
                {
                  id: 'payments',
                  label: t('detail.tabs.payments'),
                  content: <PaymentsTab studentId={studentId} />,
                },
                {
                  id: 'invoices',
                  label: t('detail.tabs.invoices'),
                  content: <InvoicesTab studentId={studentId} />,
                },
                {
                  id: 'guardians',
                  label: t('detail.tabs.guardians'),
                  content: <GuardiansTab studentId={studentId} />,
                },
                {
                  id: 'communication',
                  label: t('detail.tabs.communication'),
                  content: <CommunicationTab studentId={studentId} />,
                },
                {
                  id: 'activity',
                  label: t('detail.tabs.activity'),
                  content: <ActivityTab studentId={studentId} />,
                },
              ]}
            />

            <SendReminderDialog
              open={reminderDialogOpen}
              onOpenChange={setReminderDialogOpen}
              studentIds={[studentId]}
              onSent={() => {
                // The dialog already closes itself on success — a single
                // student's reminder leaves nothing else (no selection) to
                // clear the way the list page's bulk send does.
              }}
            />
            <TransferStatusDialog
              open={transferDialogOpen}
              onOpenChange={setTransferDialogOpen}
              studentId={studentId}
              studentName={studentQuery.data.full_name}
              currentStatus={studentQuery.data.enrollment_status}
            />
            <DeleteStudentDialog
              open={deleteDialogOpen}
              onOpenChange={setDeleteDialogOpen}
              studentId={studentId}
              studentName={studentQuery.data.full_name}
              onDeleted={() => void navigate({ to: '/students' })}
            />
          </>
        )}
      </div>
    </RegionConfigProvider>
  );
}
