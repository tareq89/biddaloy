import { useCreateStudent } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

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
  component: NewStudentPage,
});

function NewStudentPage() {
  const { t } = useTranslation('students');
  const navigate = useNavigate();
  const config = useTenantRegionConfig();
  const mutation = useCreateStudent();

  return (
    <RegionConfigProvider value={config}>
      <div className="mx-auto max-w-xl p-6">
        <h1 className="mb-6 text-lg font-semibold">{t('new.title')}</h1>
        <StudentForm
          initialValues={defaultStudentFormValues()}
          autosaveKey="new"
          submitLabel={t('new.submitAction')}
          mutation={mutation}
          buildPayload={buildCreatePayload}
          onSuccess={(student) =>
            void navigate({ to: '/students/$studentId', params: { studentId: student.id } })
          }
        />
      </div>
    </RegionConfigProvider>
  );
}
