/**
 * Epic 49 W4: "Record payment" — `POST /platform/billing/orders/:id/offline-payment`.
 * The amount is the order's, so the form only asks how it was paid and for the slip or receipt
 * number. One idempotency key per dialog open: a retry after a dropped response reuses it, and
 * the server answers `applied: false` if the order was already paid.
 */
import { ApiError } from '@biddaloy/ui/api';
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
  RadioGroup,
  RadioGroupItem,
  toast,
} from '@biddaloy/ui/components';
import { useRecordOfflinePayment, type SeatOrderDto } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'record-payment-form';
const METHODS = ['OFFLINE_BANK', 'OFFLINE_CASH'] as const;
const CHOICE =
  'flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border-functional bg-surface px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[[data-state=checked]]:font-medium has-[[data-state=checked]]:text-secondary-foreground';

interface FormValues {
  method: (typeof METHODS)[number];
  reference: string;
}

export interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
  /** The PENDING order being paid. */
  order: Pick<SeatOrderDto, 'id' | 'seats' | 'months'> | null;
}

export function RecordPaymentDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  order,
}: RecordPaymentDialogProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const pay = useRecordOfflinePayment(schoolId);
  const keyRef = React.useRef<string>(crypto.randomUUID());

  const schema = React.useMemo(
    () =>
      z.object({
        method: z.enum(METHODS),
        reference: z
          .string()
          .trim()
          .min(3, t('subscriptions.payment.errors.reference'))
          .max(100, t('subscriptions.payment.errors.reference')),
      }),
    [t],
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { method: 'OFFLINE_BANK', reference: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ method: 'OFFLINE_BANK', reference: '' });
      pay.reset();
      keyRef.current = crypto.randomUUID();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(values: FormValues) {
    if (!order) return;
    pay.mutate(
      {
        orderId: order.id,
        method: values.method,
        reference: values.reference.trim(),
        idempotency_key: keyRef.current,
      },
      {
        onSuccess: (res) => {
          onOpenChange(false);
          toast.success(
            res.applied
              ? t('subscriptions.payment.success')
              : t('subscriptions.payment.alreadyPaid'),
          );
        },
      },
    );
  }

  // Translated sentences, never the server's message.
  const inUse =
    pay.error instanceof ApiError &&
    pay.error.statusCode === 409 &&
    pay.error.details?.['code'] === 'REFERENCE_IN_USE';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pay.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" showCloseButton={!pay.isPending}>
        <DialogHeader>
          <DialogTitle>{t('subscriptions.payment.title')}</DialogTitle>
          <DialogDescription>
            {t('subscriptions.payment.description', {
              name: schoolName,
              seats: order ? formatNumber(order.seats, config) : '',
              months: order ? formatNumber(order.months, config) : '',
            })}
          </DialogDescription>
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
              name="method"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('subscriptions.payment.methodLabel')}</FormLabel>
                  <FormControl>
                    <RadioGroup
                      aria-label={t('subscriptions.payment.methodLabel')}
                      value={field.value}
                      onValueChange={field.onChange}
                      className="grid grid-cols-2 gap-2"
                    >
                      {METHODS.map((m) => (
                        <label key={m} className={CHOICE}>
                          <RadioGroupItem value={m} />
                          {t(`subscriptions.methods.${m}`)}
                        </label>
                      ))}
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reference"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="payment-reference">
                    {t('subscriptions.payment.referenceLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="payment-reference" autoComplete="off" {...field} />
                  </FormControl>
                  <FormDescription>{t('subscriptions.payment.referenceHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {pay.isError && (
          <p role="alert" className="text-caption text-destructive">
            {inUse
              ? t('subscriptions.payment.errors.referenceInUse')
              : t('subscriptions.payment.errors.generic')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={pay.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={pay.isPending}>
            {t('subscriptions.payment.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
