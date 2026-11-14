/**
 * #3888 Refund a paid seat order or SMS package order (D4, D25). Reason (5-300), then the owner's
 * code step (`platform.refund`, through `useApprovedMutation`), then a result step that says the
 * money goes back from the bKash panel: this app only records the refund. Free orders and used
 * packages show a fixed sentence and no button. Every failure is a fixed sentence (Rule 23).
 */
import { SeatOrderStatus } from '@biddaloy/shared';
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
  Textarea,
} from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  useRefundOrder,
  type PlatformBundleOrder,
  type SeatOrderDto,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'refund-form';

/** The order being refunded: a seat order or a package order, tagged by `kind`. */
export type RefundTarget =
  ({ kind: 'seat' } & SeatOrderDto) | ({ kind: 'package' } & PlatformBundleOrder);

export interface RefundDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName?: string | undefined;
  order: RefundTarget | null;
}

/** Why this order cannot be refunded, if it cannot (the server decides again). */
export function refundBlock(order: RefundTarget): 'free' | 'used' | null {
  if (order.kind === 'seat') {
    return order.status === SeatOrderStatus.PAID && order.amount_paisa <= 0 ? 'free' : null;
  }
  return order.refundable ? null : 'used';
}

export function RefundDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
  order,
}: RefundDialogProps) {
  const { t } = useTranslation('moneyBilling');
  const config = useRegionConfig();
  const refund = useRefundOrder(schoolId, order?.kind ?? 'seat');

  const schema = React.useMemo(
    () =>
      z.object({
        reason: z
          .string()
          .trim()
          .min(5, t('refund.errors.reason'))
          .max(300, t('refund.errors.reason')),
      }),
    [t],
  );
  const form = useForm<{ reason: string }>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ reason: '' });
      refund.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  const block = order ? refundBlock(order) : null;
  const amount = order ? formatCurrency(order.amount_paisa ?? 0, config) : '';
  const summary = !order
    ? ''
    : order.kind === 'seat'
      ? t('refund.seatSummary', {
          seats: formatNumber(order.seats, config),
          months: formatNumber(order.months, config),
        })
      : t('packages.line', {
          name: order.bundle_name ?? '',
          count: formatNumber(order.sms_count, config),
        });

  // Translated sentences, never the server's message.
  const code =
    refund.error instanceof ApiError && refund.error.statusCode === 409
      ? refund.error.details?.['code']
      : undefined;
  const failed = refund.isError && !(refund.error instanceof ApprovalCancelledError);
  const done = refund.isSuccess ? refund.data : null;
  const couponUsed = order?.kind === 'seat' && !!order.coupon_code;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && refund.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        size="sm"
        showCloseButton={!refund.isPending}
        className="max-md:w-full max-md:max-w-full"
      >
        <DialogHeader>
          <DialogTitle>
            {done ? t('refund.resultTitle') : t('refund.title', { amount })}
          </DialogTitle>
          <DialogDescription>
            {t('refund.description', { name: schoolName ?? '', summary })}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="grid gap-2" data-testid="refund-result">
            {!done.applied && <p>{t('refund.alreadyRefunded')}</p>}
            <p>{t('refund.instruction')}</p>
            {done.gateway_ref && <p>{t('refund.reference', { ref: done.gateway_ref })}</p>}
            {couponUsed && <p>{t('refund.couponKept')}</p>}
          </div>
        ) : block ? (
          <p role="note">{block === 'free' ? t('refund.freeOrder') : t('refund.partlyUsed')}</p>
        ) : (
          <Form {...form}>
            <form
              id={FORM_ID}
              noValidate
              onSubmit={(event) =>
                void form.handleSubmit((v) => {
                  if (!order || refund.isPending) return;
                  refund.mutate({ orderId: order.id, reason: v.reason.trim() });
                })(event)
              }
              className="grid gap-4"
            >
              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="refund-reason">{t('refund.reason')}</FormLabel>
                    <FormControl>
                      <Textarea id="refund-reason" rows={3} {...field} />
                    </FormControl>
                    <FormDescription>{t('refund.reasonHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </form>
          </Form>
        )}

        {failed && !done && (
          <p role="alert" className="text-caption text-destructive">
            {code === 'ORDER_NOT_REFUNDABLE'
              ? t('refund.errors.notRefundable')
              : code === 'BUNDLE_ALREADY_USED'
                ? t('refund.errors.used')
                : t('refund.errors.generic')}
          </p>
        )}

        <DialogFooter>
          {done || block ? (
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('refund.done')}
              </Button>
            </DialogClose>
          ) : (
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={refund.isPending}>
                  {t('actions.cancel', { ns: 'common' })}
                </Button>
              </DialogClose>
              <Button type="submit" form={FORM_ID} loading={refund.isPending}>
                {t('refund.submit')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
