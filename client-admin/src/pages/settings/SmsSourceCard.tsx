/**
 * [100.4.02] "Use SchoolManagerP SMS" for a school that sends through its own SMS company.
 * The own-provider settings are never touched: the switch only changes who sends (D9).
 * Shown at the bottom of the page and, flat, inside the dialog a Buy press opens.
 */
import { Button, Card } from '@biddaloy/ui/components';
import { usePutSmsSource } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface SmsSourceCardProps {
  /** Runs after the server accepted the switch. */
  onSwitched?: () => void;
  /** Given inside the buy flow: adds a "Not now" button. */
  onCancel?: () => void;
}

export function SmsSourceCard({ onSwitched, onCancel }: SmsSourceCardProps) {
  const { t } = useTranslation('smsBundles');
  const put = usePutSmsSource();
  const inFlow = onCancel !== undefined;
  return (
    <Card padded className={inFlow ? 'border-0 p-0 shadow-none' : 'mt-6'}>
      <h3 className="text-h3">{t('source.title')}</h3>
      <p className="mt-1 text-sm">{t('source.body')}</p>
      <p className="mt-1 text-caption text-text-secondary">{t('source.kept')}</p>
      {put.isError && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t('source.failed')}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel}>
            {t('source.cancel')}
          </Button>
        )}
        <Button
          loading={put.isPending}
          onClick={() =>
            put.mutate({ source: 'SCHOOLMANAGERP' }, { onSuccess: () => onSwitched?.() })
          }
        >
          {t(inFlow ? 'source.switchAndBuy' : 'source.switch')}
        </Button>
      </div>
    </Card>
  );
}
