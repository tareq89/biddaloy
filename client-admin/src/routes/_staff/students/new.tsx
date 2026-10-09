import { RoutePending } from '@biddaloy/ui/components';
import { useCreateStudent } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../../route-loaders';

import { StudentForm } from './-student-form';
import { buildCreatePayload, defaultStudentFormValues } from './-student-form-schema';

/**
 * `/students/new` — [8.10.3]'s real Add Student form, replacing the
 * placeholder [8.10.2] left here. A static `new.tsx` route wins over
 * `$studentId.tsx`'s dynamic segment for this exact path (standard
 * file-router precedence — static beats param), so this never collides
 * with "view student `new`".
 */
export const Route = createFileRoute('/_staff/students/new')({
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('students'),
  pendingComponent: NewStudentPending,
  component: NewStudentPage,
});

function NewStudentPage() {
  const { t } = useTranslation('students');
  const navigate = useNavigate();
  const config = useTenantRegionConfig();
  const mutation = useCreateStudent();

  return (
    <RegionConfigProvider value={config}>
      <StudentForm
        title={t('new.title')}
        onClose={() => void navigate({ to: '/students' })}
        initialValues={defaultStudentFormValues()}
        autosaveKey="new"
        submitLabel={t('new.submitAction')}
        mutation={mutation}
        buildPayload={buildCreatePayload}
        onSuccess={(student) =>
          void navigate({ to: '/students/$studentId', params: { studentId: student.id } })
        }
      />
    </RegionConfigProvider>
  );
}

function NewStudentPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
