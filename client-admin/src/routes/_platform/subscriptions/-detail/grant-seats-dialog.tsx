/**
 * Epic 49 W4: "Grant seats" — `POST /platform/billing/schools/:id/grant` via `useGrantSeats`.
 * Validation mirrors `GrantSeatsDto` (seats 1-100000, months 1-24, reason 10-500). One
 * idempotency key per dialog open, so a retry never makes a second grant. Bangla digits accepted.
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
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useGrantSeats } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'grant-seats-form';

interface FormValues {
  seats: string;
  months: string;
  reason: string;
}

const inRange = (min: number, max: number) => (v: string) =>
  /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;

export interface GrantSeatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
}

export function GrantSeatsDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
}: GrantSeatsDialogProps) {
  const { t } = useTranslation('platform');
  const grant = useGrantSeats(schoolId);
  const keyRef = React.useRef<string>(crypto.randomUUID());

  const schema = React.useMemo(
    () =>
      z.object({
        seats: z
          .string()
          .trim()
          .transform(toLatinDigits)
          .refine(inRange(1, 100000), { message: t('subscriptions.grant.errors.seats') }),
        months: z
          .string()
          .trim()
          .transform(toLatinDigits)
          .refine(inRange(1, 24), { message: t('subscriptions.grant.errors.months') }),
        reason: z
          .string()
          .trim()
          .min(10, t('subscriptions.grant.errors.reasonLength'))
          .max(500, t('subscriptions.grant.errors.reasonTooLong')),
      }),
    [t],
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { seats: '', months: '', reason: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ seats: '', months: '', reason: '' });
      grant.reset();
      keyRef.current = crypto.randomUUID();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(values: FormValues) {
    grant.mutate(
      {
        seats: Number(toLatinDigits(values.seats.trim())),
        months: Number(toLatinDigits(values.months.trim())),
        reason: values.reason.trim(),
        idempotency_key: keyRef.current,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(t('subscriptions.grant.success'));
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && grant.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" showCloseButton={!grant.isPending}>
        <DialogHeader>
          <DialogTitle>{t('subscriptions.grant.title')}</DialogTitle>
          <DialogDescription>
            {t('subscriptions.grant.description', { name: schoolName })}
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
              name="seats"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="grant-seats">{t('subscriptions.grant.seatsLabel')}</FormLabel>
                  <FormControl>
                    <Input id="grant-seats" inputMode="numeric" {...field} />
                  </FormControl>
                  <FormDescription>{t('subscriptions.grant.seatsHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="months"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="grant-months">
                    {t('subscriptions.grant.monthsLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="grant-months" inputMode="numeric" {...field} />
                  </FormControl>
                  <FormDescription>{t('subscriptions.grant.monthsHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="grant-reason">
                    {t('subscriptions.grant.reasonLabel')}
                  </FormLabel>
                  <FormControl>
                    <Textarea id="grant-reason" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {grant.isError && (
          <p role="alert" className="text-caption text-destructive">
            {t('subscriptions.grant.errors.generic')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={grant.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={grant.isPending}>
            {t('subscriptions.grant.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
