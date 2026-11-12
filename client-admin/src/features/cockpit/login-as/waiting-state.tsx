import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

/** Ask-each-time school, or the other owner's agreement for emergency access. */
export function WaitingState({
  ownerWait,
  onCancel,
}: {
  ownerWait: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation('loginAs');
  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
      <p className="font-semibold">{t('waiting.title')}</p>
      <p>{ownerWait ? t('waiting.textOwner') : t('waiting.text')}</p>
      <p className="text-sm text-muted-foreground">{t('waiting.timeLeft')}</p>
      <Button type="button" variant="outline" onClick={onCancel} className="w-full sm:w-auto">
        {t('waiting.cancel')}
      </Button>
    </div>
  );
}
