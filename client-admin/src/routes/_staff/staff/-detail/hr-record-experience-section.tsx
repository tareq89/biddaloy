/**
 * [23.9] Stub for the work-experience section — see
 * `hr-record-family-section.tsx`'s header comment for why this is a
 * placeholder and what fills it in.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordExperienceSectionProps {
  userId: string;
}

export function HrRecordExperienceSection({ userId: _userId }: HrRecordExperienceSectionProps) {
  const { t } = useTranslation('staff');
  return <p className="text-sm text-muted-foreground">{t('hrRecord.comingSoon')}</p>;
}
