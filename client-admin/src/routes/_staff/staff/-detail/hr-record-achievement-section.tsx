/**
 * [23.9] Stub for the achievements section — see
 * `hr-record-family-section.tsx`'s header comment for why this is a
 * placeholder and what fills it in.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordAchievementSectionProps {
  userId: string;
}

export function HrRecordAchievementSection({ userId: _userId }: HrRecordAchievementSectionProps) {
  const { t } = useTranslation('staff');
  return <p className="text-sm text-muted-foreground">{t('hrRecord.comingSoon')}</p>;
}
