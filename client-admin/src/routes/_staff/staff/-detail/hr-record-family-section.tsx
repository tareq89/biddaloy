/**
 * [23.9] Stub for the family-members section — [23.10] fills in the real
 * `RepeatableRowForm` config (23.8's shared repeatable-row form
 * component, not yet merged as of this ticket). Only this file's body
 * changes then; `hr-record-tab.tsx` itself is never touched again.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordFamilySectionProps {
  userId: string;
}

export function HrRecordFamilySection({ userId: _userId }: HrRecordFamilySectionProps) {
  const { t } = useTranslation('staff');
  return <p className="text-sm text-muted-foreground">{t('hrRecord.comingSoon')}</p>;
}
