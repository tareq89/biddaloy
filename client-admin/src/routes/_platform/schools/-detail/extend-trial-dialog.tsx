/**
 * [13.5] "Extend trial" dialog — `PATCH /schools/:id/trial` via
 * `useExtendTrial`. Validation mirrors `ExtendTrialDto` (days 1–365, optional
 * seat limit ≥ 0, reason 10–500). Server rejections become translated
 * sentences, never the server's own message (D9). Bangla digits are accepted.
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
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useExtendTrial } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const FORM_ID = 'extend-trial-form';

interface FormValues {
  days: string;
  seat_limit: string;
  reason: string;
}

export interface ExtendTrialDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolId: string;
  schoolName: string;
}

export function ExtendTrialDialog({
  open,
  onOpenChange,
  schoolId,
  schoolName,
}: ExtendTrialDialogProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const extend = useExtendTrial(schoolId);

  const schema = React.useMemo(
    () =>
      z.object({
        days: z
          .string()
          .trim()
          .transform(toLatinDigits)
          .refine((v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 365, {
            message: t('trial.dialog.errors.days'),
          }),
        seat_limit: z
          .string()
          .trim()
          .transform(toLatinDigits)
          .refine((v) => v === '' || /^\d{1,9}$/.test(v), {
            message: t('trial.dialog.errors.seatLimit'),
          }),
        reason: z
          .string()
          .trim()
          .min(10, t('trial.dialog.errors.reasonLength'))
          .max(500, t('trial.dialog.errors.reasonTooLong')),
      }),
    [t],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { days: '', seat_limit: '', reason: '' },
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ days: '', seat_limit: '', reason: '' });
      extend.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleSubmit(values: FormValues) {
    const seat = toLatinDigits(values.seat_limit.trim());
    extend.mutate(
      {
        days: Number(toLatinDigits(values.days.trim())),
        ...(seat !== '' ? { seat_limit: Number(seat) } : {}),
        reason: values.reason.trim(),
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          toast.success(t('trial.dialog.success'));
        },
      },
    );
  }

  let errorSentence = t('trial.dialog.errors.generic');
  const err = extend.error;
  if (err instanceof ApiError && err.statusCode === 409) {
    const code = err.details?.['code'];
    const used = err.details?.['used'];
    if (code === 'NOT_IN_TRIAL') errorSentence = t('trial.dialog.errors.notInTrial');
    else if (code === 'SEAT_LIMIT_BELOW_USAGE' && typeof used === 'number') {
      errorSentence = t('trial.dialog.errors.seatBelowUsage', {
        used: formatNumber(used, config),
      });
    }
  }

  return (
    <Dialog
      open={open}
      // A pending request must not be dismissed from under itself.
      onOpenChange={(next) => {
        if (!next && extend.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md" showCloseButton={!extend.isPending}>
        <DialogHeader>
          <DialogTitle>{t('trial.dialog.title')}</DialogTitle>
          <DialogDescription>
            {t('trial.dialog.description', { name: schoolName })}
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
              name="days"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="extend-trial-days">{t('trial.dialog.daysLabel')}</FormLabel>
                  <FormControl>
                    <Input id="extend-trial-days" inputMode="numeric" {...field} />
                  </FormControl>
                  <FormDescription>{t('trial.dialog.daysHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="seat_limit"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="extend-trial-seats">
                    {t('trial.dialog.seatLimitLabel')}
                  </FormLabel>
                  <FormControl>
                    <Input id="extend-trial-seats" inputMode="numeric" {...field} />
                  </FormControl>
                  <FormDescription>{t('trial.dialog.seatLimitHelp')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="extend-trial-reason">
                    {t('trial.dialog.reasonLabel')}
                  </FormLabel>
                  <FormControl>
                    <Textarea id="extend-trial-reason" rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </form>
        </Form>

        {extend.isError && (
          <p role="alert" className="text-caption text-destructive">
            {errorSentence}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={extend.isPending}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="submit" form={FORM_ID} loading={extend.isPending}>
            {t('trial.dialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
