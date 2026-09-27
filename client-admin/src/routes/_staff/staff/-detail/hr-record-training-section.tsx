/**
 * [23.9] Stub for the training section — see
 * `hr-record-family-section.tsx`'s header comment for why this is a
 * placeholder and what fills it in.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordTrainingSectionProps {
  userId: string;
}

export function HrRecordTrainingSection({ userId: _userId }: HrRecordTrainingSectionProps) {
  const { t } = useTranslation('staff');
  return <p className="text-sm text-muted-foreground">{t('hrRecord.comingSoon')}</p>;
}
