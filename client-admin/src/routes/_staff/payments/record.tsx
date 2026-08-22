import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * `/payments/record` — a placeholder, same reasoning as `/fees`: the real
 * Record Payment flow is [8.10.5]'s ticket, not this one's. Exists now so
 * [8.10.1]'s "Collect Fees" row action has a real, typed route to
 * `<Link>` into — `student_id` is declared and read here already so
 * [8.10.5] only has to replace `RecordPaymentPage`'s body, not re-wire the
 * deep link this ticket's students list already depends on.
 */
const recordPaymentSearchSchema = z.object({
  student_id: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/payments/record')({
  validateSearch: recordPaymentSearchSchema,
  component: RecordPaymentPage,
});

function RecordPaymentPage() {
  const { t } = useTranslation('payments');
  const navigate = useNavigate();
  const { student_id } = Route.useSearch();

  return (
    <EmptyState
      title={t('record.title')}
      explanation={
        student_id !== undefined
          ? t('record.explanationForStudent', { studentId: student_id })
          : t('record.explanation')
      }
      action={{ label: t('record.action'), onClick: () => void navigate({ to: '/students' }) }}
    />
  );
}
