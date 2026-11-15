import { useTranslation } from '@biddaloy/ui/i18n';

/** Stub — a later wave-4 ticket fills this panel (#2204 D11). */
export function AdmissionPrintMenu() {
  const { t } = useTranslation('admission-desk');
  return <h2 className="text-lg font-semibold">{t('panels.print')}</h2>;
}
