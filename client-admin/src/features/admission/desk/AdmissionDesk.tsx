import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';

/** Stub — a later wave-4 ticket fills this page (#2204 D11). */
export function AdmissionDesk() {
  const { t } = useTranslation('admission-desk');
  return (
    <PageContainer>
      <h1 className="text-2xl font-semibold">{t('desk.title')}</h1>
    </PageContainer>
  );
}
