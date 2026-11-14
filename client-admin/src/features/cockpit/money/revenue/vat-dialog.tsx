/**
 * #3889 VAT on receipts: one setting for all schools (D41), saved with a step-up code (`platform.vat`).
 * Rate 0.01 to 50 with two decimals (the server's range); the switch turns VAT off. A failed save
 * shows one fixed sentence (Rule 23).
 */
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  toast,
} from '@biddaloy/ui/components';
import { usePlatformVat, useUpdatePlatformVat } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export function VatDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('moneyRevenue');
  const current = usePlatformVat(open);
  const save = useUpdatePlatformVat();
  const [rate, setRate] = React.useState('');
  const [label, setLabel] = React.useState('');
  const [skip, setSkip] = React.useState(false);
  const [invalid, setInvalid] = React.useState<'rate' | 'label' | null>(null);

  React.useEffect(() => {
    if (!open || !current.data) return;
    setRate(current.data.rate_percent === null ? '' : String(current.data.rate_percent));
    setLabel(current.data.label);
    setSkip(!current.data.enabled);
    setInvalid(null);
    save.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset when opened or loaded
  }, [open, current.data]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = label.trim();
    const percent = Number(rate);
    if (!skip && (text.length < 1 || text.length > 20)) return setInvalid('label');
    const rateOk = /^\d+(\.\d{1,2})?$/.test(rate.trim()) && percent >= 0.01 && percent <= 50;
    if (!skip && !rateOk) return setInvalid('rate');
    setInvalid(null);
    save.mutate(skip ? { enabled: false } : { enabled: true, rate_percent: percent, label: text }, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(t('vat.saved'));
      },
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!next && save.isPending ? undefined : onOpenChange(next))}
    >
      <DialogContent size="md" showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>{t('vat.title')}</DialogTitle>
          <DialogDescription>{t('vat.description')}</DialogDescription>
        </DialogHeader>
        <form id="vat-form" noValidate onSubmit={submit} className="grid gap-4">
          <div className="flex items-center gap-3">
            <Switch id="vat-skip" checked={skip} onCheckedChange={setSkip} />
            <Label htmlFor="vat-skip">{t('vat.skip')}</Label>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="vat-rate">{t('vat.rate')}</Label>
            <Input
              id="vat-rate"
              inputMode="decimal"
              value={rate}
              disabled={skip}
              aria-invalid={invalid === 'rate'}
              onChange={(e) => setRate(e.target.value)}
            />
            {invalid === 'rate' && (
              <p role="alert" className="text-caption text-destructive">
                {t('vat.errors.rate')}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="vat-label">{t('vat.label')}</Label>
            <Input
              id="vat-label"
              value={label}
              aria-invalid={invalid === 'label'}
              onChange={(e) => setLabel(e.target.value)}
            />
            {invalid === 'label' && (
              <p role="alert" className="text-caption text-destructive">
                {t('vat.errors.label')}
              </p>
            )}
          </div>
        </form>
        {current.isError && (
          <p role="alert" className="text-caption text-destructive">
            {t('vat.errors.load')}
          </p>
        )}
        {save.isError && (
          <p role="alert" className="text-caption text-destructive">
            {t('vat.errors.generic')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={save.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form="vat-form" loading={save.isPending} disabled={!current.data}>
            {t('vat.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
