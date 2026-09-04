import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import { studentQueryOptions, useStudent, useUpdateStudent } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { StudentForm } from './-student-form';
import { buildUpdatePayload, studentToFormValues } from './-student-form-schema';

/**
 * `/students/$studentId/edit` — [8.10.3]'s real Edit Student form,
 * replacing the placeholder [8.10.2] left here (its detail page's Edit
 * action already links here). Same `StudentForm` as `new.tsx`, prefilled
 * from `useStudent`, whose `studentQueryOptions(studentId)` cache entry
 * `$studentId.tsx` (the detail page this is usually reached from) has
 * often already warmed — but [8.14.5] adds this route's own `loader`
 * anyway, for the deep-link case where a bookmark or a shared URL lands
 * here first, with nothing upstream to have warmed the cache.
 */
export const Route = createFileRoute('/_staff/students/$studentId_/edit')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient
        .ensureQueryData(studentQueryOptions(params.studentId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('students'),
    ]),
  pendingComponent: EditStudentPending,
  component: EditStudentPage,
});

function EditStudentPage() {
  const { studentId } = Route.useParams();
  const { t } = useTranslation('students');
  const navigate = useNavigate();
  const config = useTenantRegionConfig();
  const studentQuery = useStudent(studentId);
  const mutation = useUpdateStudent(studentId);

  return (
    <RegionConfigProvider value={config}>
      <div className="mx-auto max-w-xl p-6">
        <h1 className="mb-6 text-lg font-semibold">{t('edit.title')}</h1>
        {studentQuery.isPending ? (
          <Skeleton className="h-7 w-64" />
        ) : studentQuery.isError ? (
          <ErrorState
            message={
              studentQuery.error instanceof ApiError && studentQuery.error.statusCode === 403
                ? t('detail.forbidden')
                : t('detail.loadError')
            }
            onRetry={() => void studentQuery.refetch()}
          />
        ) : (
          <StudentForm
            initialValues={studentToFormValues(studentQuery.data)}
            initialGuardians={studentQuery.data.guardians}
            autosaveKey={studentId}
            submitLabel={t('edit.submitAction')}
            mutation={mutation}
            buildPayload={buildUpdatePayload}
            onSuccess={() => void navigate({ to: '/students/$studentId', params: { studentId } })}
          />
        )}
      </div>
    </RegionConfigProvider>
  );
}

function EditStudentPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
