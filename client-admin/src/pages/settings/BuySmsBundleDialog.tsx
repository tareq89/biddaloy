/**
 * [100.4.02] Buy one SMS package: pick, create the order, pay with bKash (D12, no cart).
 * `BuySmsBundleDialog` is presentational; `BuySmsBundleFlow` wires the hooks.
 * The create hook keeps its Idempotency-Key in a ref for the life of the component, so the
 * caller mounts the flow with `key={package id}`: a different package never rides an old key.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import {
  useCreateSmsBundleOrder,
  usePaySmsBundleWithBkash,
  type SmsBundleOrder,
  type SmsPackage,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency, formatNumber } from '@biddaloy/ui/utils';

import { payClosedOrder } from '../../features/billing/BuySeatsFlow';

export type BuyFailure = 'paused' | 'other';

export interface BuySmsBundleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packages: SmsPackage[];
  selected: SmsPackage;
  onSelect: (id: string) => void;
  pending?: boolean;
  failure?: BuyFailure | undefined;
  created?: SmsBundleOrder | undefined;
  onPay?: (orderId: string) => void;
  paying?: boolean;
  payFailed?: boolean;
  onSubmit: () => void;
}

export function BuySmsBundleDialog({
  open,
  onOpenChange,
  packages,
  selected,
  onSelect,
  pending,
  failure,
  created,
  onPay,
  paying,
  payFailed,
  onSubmit,
}: BuySmsBundleDialogProps) {
  const { t } = useTranslation('smsBundles');
  const config = useRegionConfig();
  const sms = formatNumber(selected.smsCount, config);
  const price = formatCurrency(Number(selected.pricePaisa), config);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('buy.createdTitle')}</DialogTitle>
              <DialogDescription>{t('buy.createdBody', { sms, price })}</DialogDescription>
            </DialogHeader>
            {payFailed && (
              <p role="alert" className="text-sm text-destructive">
                {t('buy.tryAgain')}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('buy.close')}
              </Button>
              {onPay && (
                <Button loading={paying ?? false} onClick={() => onPay(created.id)}>
                  {t('buy.payBkash')}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('buy.title', { sms })}</DialogTitle>
              <DialogDescription>
                {t('buy.summary', {
                  price,
                  days: formatNumber(selected.validityDays, config),
                })}
              </DialogDescription>
            </DialogHeader>
            {packages.length > 1 && (
              <div className="grid gap-1.5">
                <Label htmlFor="buy-sms-package">{t('buy.package')}</Label>
                <Select value={selected.id} onValueChange={onSelect}>
                  <SelectTrigger id="buy-sms-package">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}: {t('packages.sms', { n: formatNumber(p.smsCount, config) })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {failure && (
              <p role="alert" className="text-sm text-destructive">
                {t(failure === 'paused' ? 'buy.cannotSell' : 'buy.tryAgain')}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('buy.cancel')}
              </Button>
              <Button loading={pending ?? false} onClick={onSubmit}>
                {t('buy.submit')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** What the create step refused with: `SMS_SALES_PAUSED` is the "we cannot sell now" sentence. */
function failureOf(err: unknown): BuyFailure | undefined {
  if (!err) return undefined;
  return err instanceof ApiError && err.details?.['code'] === 'SMS_SALES_PAUSED'
    ? 'paused'
    : 'other';
}

export function BuySmsBundleFlow(
  props: Omit<
    BuySmsBundleDialogProps,
    'onSubmit' | 'pending' | 'failure' | 'created' | 'onPay' | 'paying' | 'payFailed'
  >,
) {
  const create = useCreateSmsBundleOrder();
  const pay = usePaySmsBundleWithBkash();

  function payOrder(orderId: string) {
    pay.mutate(orderId, {
      onSuccess: (r) => window.location.assign(r.bkash_url),
      // A closed order: back to the form, where the next Buy makes a new one.
      onError: (err) => {
        if (payClosedOrder(err)) create.reset();
      },
    });
  }

  return (
    <BuySmsBundleDialog
      {...props}
      onOpenChange={(open) => {
        if (!open) {
          create.reset();
          pay.reset();
        }
        props.onOpenChange(open);
      }}
      pending={create.isPending}
      failure={failureOf(create.error)}
      created={create.data}
      paying={pay.isPending || pay.isSuccess}
      payFailed={pay.isError}
      onPay={payOrder}
      onSubmit={() => {
        pay.reset();
        create.mutate(
          { package_id: props.selected.id },
          { onSuccess: (order) => payOrder(order.id) },
        );
      }}
    />
  );
}
