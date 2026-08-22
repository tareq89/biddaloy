import { useStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';

/**
 * `/students/$studentId` — the dynamic-segment reference route for
 * [8.9.1]'s "deep links restore full page state" AC: opening this URL
 * directly (refresh, a pasted link, a colleague's bookmark) renders the
 * same student the original navigation did, because `$studentId` is the
 * only state this page needs and it lives entirely in the path.
 */
export const Route = createFileRoute('/_staff/students/$studentId')({
  component: StudentDetailPage,
});

function StudentDetailPage() {
  const { studentId } = Route.useParams();
  const { t } = useTranslation('students');
  const studentQuery = useStudent(studentId);

  return (
    <div className="flex flex-col gap-4">
      <Link to="/students" className="text-sm text-primary underline">
        {t('detail.back')}
      </Link>
      <h1 className="text-lg font-semibold">{studentQuery.data?.full_name ?? studentId}</h1>
    </div>
  );
}
