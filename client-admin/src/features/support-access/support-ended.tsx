import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

/** [99.G4.02] Shown after a Login as tab ends (button, expiry or wake-up). */
export function SupportEnded() {
  const { t } = useTranslation('supportBanner');
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface p-6 text-center print:hidden">
      <h1 className="text-lg font-semibold">{t('ended.title')}</h1>
      <p role="status">{t('ended.body')}</p>
      <Button type="button" onClick={() => window.close()}>
        {t('ended.close')}
      </Button>
    </div>
  );
}
