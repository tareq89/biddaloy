/**
 * [23.9] Stub for the languages section — see
 * `hr-record-family-section.tsx`'s header comment for why this is a
 * placeholder and what fills it in.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordLanguageSectionProps {
  userId: string;
}

export function HrRecordLanguageSection({ userId: _userId }: HrRecordLanguageSectionProps) {
  const { t } = useTranslation('staff');
  return <p className="text-sm text-muted-foreground">{t('hrRecord.comingSoon')}</p>;
}
