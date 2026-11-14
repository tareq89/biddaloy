/**
 * #3885 "Record SMS bought" (D11): `POST /platform/sms-stock` via `useRecordSmsStock`. The cost is a
 * `MoneyInput` (whole paisa) and goes out as taka. The "company shows now" field appears only when
 * the provider balance is not read from the provider itself (D8) and, when filled, is sent to
 * `POST /platform/sms-stock/balance` after the purchase is saved. The idempotency key comes from
 * `useIdempotencyKey` inside the hook: the same body re-sent keeps its key.
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
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  MoneyInput,
  toast,
} from '@biddaloy/ui/components';
import {
  usePlatformSmsBalance,
  useRecordProviderBalance,
  useRecordSmsStock,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'record-stock-form';

interface FormValues {
  boughtOn: string;
  smsCount: string;
  costPaisa: number | undefined;
  note: string;
  balance: string;
}

/** Local calendar date as `YYYY-MM-DD` (not UTC: the owner's "today"). */
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const blank = (): FormValues => ({
  boughtOn: today(),
  smsCount: '',
  costPaisa: undefined,
  note: '',
  balance: '',
});

const isWhole = (v: string) => /^\d+$/.test(toLatinDigits(v.trim()));

export interface RecordStockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RecordStockDialog({ open, onOpenChange }: RecordStockDialogProps) {
  const { t } = useTranslation('moneyStock');
  const config = useRegionConfig();
  const record = useRecordSmsStock();
  const recordBalance = useRecordProviderBalance();
  const balance = usePlatformSmsBalance();
  const showBalance = balance.data?.source !== 'PROVIDER';

  const schema = React.useMemo(
    () =>
      z.object({
        boughtOn: z.string().min(1, t('dialog.errors.date')),
        smsCount: z.string().refine((v) => isWhole(v) && Number(toLatinDigits(v.trim())) > 0, {
          message: t('dialog.errors.smsCount'),
        }),
        costPaisa: z
          .custom<number | undefined>()
          .refine((v) => v !== undefined && v > 0, { message: t('dialog.errors.cost') }),
        note: z.string().trim().max(500),
        balance: z.string().refine((v) => v.trim() === '' || isWhole(v), {
          message: t('dialog.errors.balance'),
        }),
      }),
    [t],
  );
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: blank() });

  React.useEffect(() => {
    if (open) {
      form.reset(blank());
      record.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(values: FormValues) {
    const note = values.note.trim();
    record.mutate(
      {
        boughtOn: values.boughtOn,
        smsCount: Number(toLatinDigits(values.smsCount.trim())),
        costTaka: (values.costPaisa ?? 0) / 100,
        ...(note ? { note } : {}),
      },
      {
        onSuccess: () => {
          if (showBalance && values.balance.trim() !== '') {
            recordBalance.mutate(
              { smsBalance: Number(toLatinDigits(values.balance.trim())) },
              { onError: () => toast.error(t('dialog.errors.generic')) },
            );
          }
          onOpenChange(false);
          toast.success(t('dialog.saved'));
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && record.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" showCloseButton={!record.isPending}>
        <DialogHeader>
          <DialogTitle>{t('dialog.title')}</DialogTitle>
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
              name="boughtOn"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="stock-date">{t('dialog.date')}</FormLabel>
                  <FormControl>
                    <Input id="stock-date" type="date" max={today()} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="smsCount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="stock-count">{t('dialog.smsCount')}</FormLabel>
                  <FormControl>
                    <Input id="stock-count" inputMode="numeric" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="costPaisa"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="stock-cost">{t('dialog.cost')}</FormLabel>
                  <FormControl>
                    <MoneyInput
                      id="stock-cost"
                      config={config}
                      value={field.value}
                      onValueChange={field.onChange}
                      onBlur={field.onBlur}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="stock-note">{t('dialog.note')}</FormLabel>
                  <FormControl>
                    <Input id="stock-note" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {showBalance && (
              <FormField
                control={form.control}
                name="balance"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="stock-balance">{t('dialog.balance')}</FormLabel>
                    <FormControl>
                      <Input id="stock-balance" inputMode="numeric" {...field} />
                    </FormControl>
                    <FormDescription>{t('dialog.balanceHelp')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </form>
        </Form>

        {record.isError && (
          <p role="alert" className="text-caption text-destructive">
            {t('dialog.errors.generic')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={record.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={record.isPending}>
            {t('dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
