/**
 * #3884 New and edit SMS package (D22). Create and edit are `useApprovedMutation`s (step-up scope
 * `platform.plan`, so saving opens the code prompt). Price is a `MoneyInput` in whole paisa and goes
 * out as taka. A failed save shows one fixed sentence, never the server text (Rule 23). The
 * `Idempotency-Key` comes from `useIdempotencyKey` inside `useCreateSmsPackage`.
 */
import {
  SMS_PACKAGE_MAX_DAYS,
  SMS_PACKAGE_MAX_SMS,
  SMS_PACKAGE_MIN_DAYS,
  SMS_PACKAGE_MIN_SMS,
} from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  MoneyInput,
  PackageCard,
  toast,
} from '@biddaloy/ui/components';
import { useCreateSmsPackage, useUpdateSmsPackage, type SmsPackage } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber, toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'sms-package-form';
/** Rule 5: `MONEY_MAX` (99,999,999.99) in whole paisa. The server constant is not shared. */
const PRICE_MAX_PAISA = 9_999_999_999;

interface FormValues {
  name: string;
  smsCount: string;
  validityDays: string;
  pricePaisa: number | undefined;
}

const blank = (pkg?: SmsPackage): FormValues =>
  pkg
    ? {
        name: pkg.name,
        smsCount: String(pkg.smsCount),
        validityDays: String(pkg.validityDays),
        pricePaisa: Number(pkg.pricePaisa),
      }
    : { name: '', smsCount: '', validityDays: '', pricePaisa: undefined };

const toInt = (v: string) => {
  const s = toLatinDigits(v.trim());
  return /^\d+$/.test(s) ? Number(s) : NaN;
};
const inRange = (v: string, min: number, max: number) => {
  const n = toInt(v);
  return n >= min && n <= max;
};

export interface PackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set for edit; absent for a new package. */
  pkg?: SmsPackage | undefined;
}

export function PackageDialog({ open, onOpenChange, pkg }: PackageDialogProps) {
  const { t } = useTranslation('moneyPackages');
  const config = useRegionConfig();
  const create = useCreateSmsPackage();
  const update = useUpdateSmsPackage();
  const save = pkg ? update : create;

  const schema = React.useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('dialog.errors.name')).max(100, t('dialog.errors.name')),
        smsCount: z.string().refine((v) => inRange(v, SMS_PACKAGE_MIN_SMS, SMS_PACKAGE_MAX_SMS), {
          message: t('dialog.errors.smsCount', {
            min: formatNumber(SMS_PACKAGE_MIN_SMS, config),
            max: formatNumber(SMS_PACKAGE_MAX_SMS, config),
          }),
        }),
        validityDays: z
          .string()
          .refine((v) => inRange(v, SMS_PACKAGE_MIN_DAYS, SMS_PACKAGE_MAX_DAYS), {
            message: t('dialog.errors.validityDays', {
              min: SMS_PACKAGE_MIN_DAYS,
              max: SMS_PACKAGE_MAX_DAYS,
            }),
          }),
        pricePaisa: z
          .custom<number | undefined>()
          .refine((v) => v !== undefined && v > 0 && v <= PRICE_MAX_PAISA, {
            message: t('dialog.errors.price', {
              max: formatCurrency(PRICE_MAX_PAISA, config),
            }),
          }),
      }),
    [t, config],
  );
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank(pkg) });

  React.useEffect(() => {
    if (open) {
      form.reset(blank(pkg));
      create.reset();
      update.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open, pkg?.id]);

  function handleSubmit(values: FormValues) {
    const body = {
      name: values.name.trim(),
      smsCount: toInt(values.smsCount),
      validityDays: toInt(values.validityDays),
      priceTaka: (values.pricePaisa ?? 0) / 100,
    };
    const onSuccess = () => {
      onOpenChange(false);
      toast.success(t('dialog.saved'));
    };
    if (pkg) update.mutate({ id: pkg.id, ...body }, { onSuccess });
    else create.mutate(body, { onSuccess });
  }

  const watched = form.watch();
  const sms = toInt(watched.smsCount);
  const days = toInt(watched.validityDays);
  const price = watched.pricePaisa;
  const perSms = price && sms > 0 ? formatNumber(price / 100 / sms, config, { decimals: 2 }) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && save.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" showCloseButton={!save.isPending}>
        <DialogHeader>
          <DialogTitle>{pkg ? t('dialog.editTitle') : t('dialog.newTitle')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            id={FORM_ID}
            noValidate
            onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
            className="grid gap-4"
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="package-name">{t('dialog.name')}</FormLabel>
                  <FormControl>
                    <Input id="package-name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="smsCount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="package-sms">{t('dialog.smsCount')}</FormLabel>
                    <FormControl>
                      <Input id="package-sms" inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="validityDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="package-days">{t('dialog.validityDays')}</FormLabel>
                    <FormControl>
                      <Input id="package-days" inputMode="numeric" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="pricePaisa"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="package-price">{t('dialog.price')}</FormLabel>
                  <FormControl>
                    <MoneyInput
                      id="package-price"
                      config={config}
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  {perSms && (
                    <FormDescription>{t('dialog.perSms', { value: perSms })}</FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        <section aria-label={t('dialog.preview')} className="grid gap-2">
          <p className="text-caption text-text-secondary">{t('dialog.preview')}</p>
          <PackageCard
            name={watched.name.trim() || t('dialog.previewName')}
            smsCount={sms > 0 ? formatNumber(sms, config) : '-'}
            priceLabel={price ? formatCurrency(price, config) : '-'}
            validityLabel={days > 0 ? t('dialog.previewDays', { count: days }) : '-'}
            buyLabel={t('dialog.previewBuy')}
            onBuy={() => undefined}
            disabledReason={t('dialog.previewNote')}
          />
        </section>

        {save.isError && (
          <p role="alert" className="text-caption text-destructive">
            {t('dialog.errors.generic')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={save.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={save.isPending}>
            {t('dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
