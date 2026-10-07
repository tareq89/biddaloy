/** Exam status as a coloured badge — used by the list and the detail header. */
import { StatusBadge, type StatusTone } from '@biddaloy/ui/components';
import type { Exam } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

const TONE: Record<Exam['status'], StatusTone> = {
  DRAFT: 'neutral',
  PROCESSED: 'info',
  PUBLISHED: 'success',
};

export function ExamStatusBadge({ status }: { status: Exam['status'] }) {
  const { t } = useTranslation('exams');
  return <StatusBadge tone={TONE[status]} label={t(`status.${status}`)} />;
}
