import { AuthLayout } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

/**
 * [#4209] What an old `/admission/<slug>` or `/admission/<slug>/status` link shows. The public form
 * and the status check now live on the school website; this page reads no school and calls no API.
 */
export function AdmissionMoved() {
  const { t } = useTranslation('admission-public');
  return (
    <AuthLayout size="wide">
      <h1 className="text-h1">{t('moved.title')}</h1>
      <p className="mt-2 text-text-secondary">{t('moved.body')}</p>
    </AuthLayout>
  );
}
