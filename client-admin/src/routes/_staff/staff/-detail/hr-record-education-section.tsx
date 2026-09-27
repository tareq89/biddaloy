/**
 * [23.9] Stub for the education section — see
 * `hr-record-family-section.tsx`'s header comment for why this is a
 * placeholder and what fills it in.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordEducationSectionProps {
  userId: string;
}

export function HrRecordEducationSection({ userId: _userId }: HrRecordEducationSectionProps) {
  const { t } = useTranslation('staff');
  return <p className="text-sm text-muted-foreground">{t('hrRecord.comingSoon')}</p>;
}
