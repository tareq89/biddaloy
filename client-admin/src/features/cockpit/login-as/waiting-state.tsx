import { Button } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

/** Ask-each-time school, or the other owner's agreement for emergency access. */
export function WaitingState({
  ownerWait,
  outcome = 'pending',
  cancelFailed = false,
  onCancel,
  onOpen,
}: {
  ownerWait: boolean;
  /** `approved`: Login as can be opened. `over`: denied, ended or expired. */
  outcome?: 'pending' | 'approved' | 'over';
  cancelFailed?: boolean;
  onCancel: () => void;
  onOpen?: () => void;
}) {
  const { t } = useTranslation('loginAs');
  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border border-border-subtle p-4">
      <p className="font-semibold">
        {outcome === 'approved'
          ? t('waiting.approvedTitle')
          : outcome === 'over'
            ? t('waiting.overTitle')
            : t('waiting.title')}
      </p>
      <p>
        {outcome === 'approved'
          ? t('waiting.approvedText')
          : outcome === 'over'
            ? t('waiting.overText')
            : ownerWait
              ? t('waiting.textOwner')
              : t('waiting.text')}
      </p>
      {outcome === 'pending' && (
        <p className="text-sm text-muted-foreground">{t('waiting.timeLeft')}</p>
      )}
      {cancelFailed && (
        <p role="alert" className="text-sm text-destructive">
          {t('waiting.cancelError')}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row">
        {outcome === 'approved' && onOpen && (
          <Button type="button" onClick={onOpen} className="w-full sm:w-auto">
            {t('waiting.open')}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onCancel} className="w-full sm:w-auto">
          {outcome === 'over'
            ? t('waiting.back')
            : cancelFailed
              ? t('waiting.retry')
              : t('waiting.cancel')}
        </Button>
      </div>
    </div>
  );
}
