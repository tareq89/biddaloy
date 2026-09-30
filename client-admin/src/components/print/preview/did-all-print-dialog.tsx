/**
 * [32.3.4] "Did all N cards print correctly?" (D25). The answer is what unlocks
 * the next batch. "Some failed…" lists the cards to tick; after a confirm with
 * failures the person can reprint just those (a new job, new copy numbers) and
 * this dialog asks again for that job.
 */
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface DidAllPrintItem {
  id: string;
  label: string;
}

export interface DidAllPrintDialogProps {
  open: boolean;
  items: DidAllPrintItem[];
  /** Saves the answer; rejects if it could not be saved. `failedItemIds` is empty when all printed. */
  onConfirm: (failedItemIds: string[]) => Promise<void>;
  onReprintFailed: (failedItemIds: string[]) => void;
  /** Close and move on (unlocks the next batch, or finishes). */
  onContinue: () => void;
}

type Step = 'ask' | 'pick' | 'done';

export function DidAllPrintDialog({
  open,
  items,
  onConfirm,
  onReprintFailed,
  onContinue,
}: DidAllPrintDialogProps) {
  const { t } = useTranslation('printPreview');
  const [step, setStep] = React.useState<Step>('ask');
  const [failed, setFailed] = React.useState<string[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(false);

  async function save(failedIds: string[]) {
    setSaving(true);
    setError(false);
    try {
      await onConfirm(failedIds);
      setFailed(failedIds);
      setStep('done');
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  function toggle(id: string) {
    setFailed((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  return (
    // The answer is required: it isn't dismissable by clicking outside or pressing Escape.
    <Dialog open={open} onOpenChange={() => undefined}>
      <DialogContent
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('confirm.title', { count: items.length })}</DialogTitle>
        </DialogHeader>

        {step === 'pick' ? (
          <fieldset className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            <legend className="mb-1 text-sm text-muted-foreground">{t('confirm.pick')}</legend>
            {items.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={failed.includes(item.id)}
                  onCheckedChange={() => toggle(item.id)}
                />
                {item.label}
              </label>
            ))}
          </fieldset>
        ) : null}

        {step === 'done' ? (
          <p role="status" className="text-sm">
            {t('confirm.recorded')}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {t('confirm.error')}
          </p>
        ) : null}

        <DialogFooter>
          {step === 'ask' ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setStep('pick')}
              >
                {t('confirm.some')}
              </Button>
              <Button type="button" loading={saving} onClick={() => void save([])}>
                {t('confirm.yes')}
              </Button>
            </>
          ) : null}
          {step === 'pick' ? (
            <Button type="button" loading={saving} onClick={() => void save(failed)}>
              {saving ? t('confirm.saving') : t('confirm.confirm')}
            </Button>
          ) : null}
          {step === 'done' ? (
            <>
              {failed.length > 0 ? (
                <Button type="button" variant="outline" onClick={() => onReprintFailed(failed)}>
                  {t('confirm.reprintFailed', { count: failed.length })}
                </Button>
              ) : null}
              <Button type="button" onClick={onContinue}>
                {t('confirm.continue')}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
