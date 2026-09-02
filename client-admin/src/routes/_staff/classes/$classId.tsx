import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import { classQueryOptions, useClass, useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ClassFormDialog } from './-class-form-dialog';
import { DeleteClassDialog } from './-delete-class-dialog';
import { FeeStructuresTab } from './-detail/fee-structures-tab';
import { SectionsTab } from './-detail/sections-tab';
import { StudentsTab } from './-detail/students-tab';
import { TeachersTab } from './-detail/teachers-tab';

export const Route = createFileRoute('/_staff/classes/$classId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient.ensureQueryData(classQueryOptions(params.classId)).catch(() => undefined),
      loadRouteNamespaces('classes', 'common'),
    ]),
  pendingComponent: ClassDetailPending,
  component: ClassDetailPage,
});

const TAB_IDS = ['sections', 'students', 'feeStructures', 'teachers'] as const;

function ClassDetailPage() {
  const { classId } = Route.useParams();
  const { t } = useTranslation('classes');
  const { t: tCommon } = useTranslation('common');
  const navigate = useNavigate();

  const classQuery = useClass(classId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);
  const canManage = useHasPermission(Permission.CLASS_MANAGE);

  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  if (classQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (classQuery.isError) {
    const forbidden = classQuery.error instanceof ApiError && classQuery.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('list.errorMessage')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void classQuery.refetch()}
      />
    );
  }

  const klass = classQuery.data;

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/classes"
        className="inline-flex min-h-6 min-w-6 items-center self-start text-sm text-primary underline"
      >
        {t('list.title')}
      </Link>

      <DetailShell
        name={klass.name}
        identifiers={
          <>
            {t('detail.grade', { grade: klass.numeric_grade ?? t('list.noGrade') })} ·{' '}
            {klass.academic_year.name}
          </>
        }
        actions={[
          {
            id: 'edit',
            label: t('list.edit'),
            onClick: () => setEditOpen(true),
            allowed: canManage,
          },
          {
            id: 'delete',
            label: t('list.delete'),
            onClick: () => setDeleteOpen(true),
            variant: 'destructive',
            allowed: canManage,
          },
        ]}
        tabs={[
          {
            id: 'sections',
            label: t('detail.tabSections'),
            content: <SectionsTab classId={klass.id} className={klass.name} />,
          },
          {
            id: 'students',
            label: t('detail.tabStudents'),
            content: <StudentsTab classId={klass.id} />,
          },
          {
            id: 'feeStructures',
            label: t('detail.tabFeeStructures'),
            content: <FeeStructuresTab classId={klass.id} />,
          },
          {
            id: 'teachers',
            label: t('detail.tabTeachers'),
            content: <TeachersTab classId={klass.id} />,
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {canManage && (
        <ClassFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          mode="edit"
          classId={klass.id}
          initialValues={{ name: klass.name, numericGrade: klass.numeric_grade ?? undefined }}
          onSaved={() => setEditOpen(false)}
        />
      )}

      {canManage && (
        <DeleteClassDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          classId={klass.id}
          className={klass.name}
          onDeleted={() => void navigate({ to: '/classes' })}
        />
      )}
    </div>
  );
}

function ClassDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
