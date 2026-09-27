/**
 * [23.9] Stub for the documents section — [23.11] fills in the real
 * upload/list UI on top of `StaffDocument` (already merged server-side).
 * Only this file's body changes then; `hr-record-tab.tsx` itself is never
 * touched again.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordDocumentsSectionProps {
  userId: string;
}

export function HrRecordDocumentsSection({ userId: _userId }: HrRecordDocumentsSectionProps) {
  const { t } = useTranslation('staff');
  return <p className="text-sm text-muted-foreground">{t('hrRecord.comingSoon')}</p>;
}
