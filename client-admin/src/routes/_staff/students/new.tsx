import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

/**
 * `/students/new` — a placeholder, same reasoning as `/payments/record`:
 * the real Add Student form is [8.10.3]'s ticket, not this one's. A
 * static `new.tsx` route wins over `$studentId.tsx`'s dynamic segment for
 * this exact path (standard file-router precedence — static beats
 * param), so this never collides with "view student `new`".
 */
export const Route = createFileRoute('/_staff/students/new')({
  component: NewStudentPage,
});

function NewStudentPage() {
  const { t } = useTranslation('students');
  const navigate = useNavigate();

  return (
    <EmptyState
      title={t('new.title')}
      explanation={t('new.explanation')}
      action={{ label: t('new.action'), onClick: () => void navigate({ to: '/students' }) }}
    />
  );
}
