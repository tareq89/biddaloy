/**
 * [23.9] Stub for the addresses section — see `hr-record-family-section.tsx`'s
 * header comment for why this is a placeholder and what fills it in.
 */
import { useTranslation } from '@biddaloy/ui/i18n';

export interface HrRecordAddressSectionProps {
  userId: string;
}

export function HrRecordAddressSection({ userId: _userId }: HrRecordAddressSectionProps) {
  const { t } = useTranslation('staff');
  return <p className="text-sm text-muted-foreground">{t('hrRecord.comingSoon')}</p>;
}
