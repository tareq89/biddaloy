import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

/**
 * `/students/$studentId/edit` — a placeholder, same reasoning as
 * `/students/new`: the real Edit Student form is [8.10.3]'s ticket
 * ("Add and edit a student"), not this one's. [8.10.2]'s detail page
 * links here from its Edit action so that link isn't a dead end while
 * [8.10.3] is still unbuilt.
 */
export const Route = createFileRoute('/_staff/students/$studentId_/edit')({
  component: EditStudentPage,
});

function EditStudentPage() {
  const { studentId } = Route.useParams();
  const { t } = useTranslation('students');
  const navigate = useNavigate();

  return (
    <EmptyState
      title={t('edit.title')}
      explanation={t('edit.explanation')}
      action={{
        label: t('edit.action'),
        onClick: () => void navigate({ to: '/students/$studentId', params: { studentId } }),
      }}
    />
  );
}
