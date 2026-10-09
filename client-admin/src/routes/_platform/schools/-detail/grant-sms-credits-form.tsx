/**
 * [15.6.8/#551] The SUPER_ADMIN console's grant/adjust form on the school
 * detail page — `POST /schools/:id/sms-credits`. `units` signs the
 * movement (positive grants, negative adjusts down), `reason` is
 * mandatory (min 5 chars, mirroring `GrantSmsCreditsDto`).
 *
 * Presentational only — parses/validates the two fields and hands the
 * caller `{ units, reason }`; `sms-credits-card.tsx` owns the mutation
 * *and* the idempotency key (a submit attempt's key must survive a retry
 * of that same attempt, which is state that outlives any one call to
 * `onSubmit` here). Fields only: the dialog's footer holds the submit
 * button and points at this form through `formId`.
 */
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

interface GrantFormValues {
  units: string;
  reason: string;
}

export interface GrantFormOutput {
  units: number;
  reason: string;
}

export interface GrantSmsCreditsFormProps {
  /** `id` of the `<form>` — the dialog footer's submit button targets it. */
  formId: string;
  onFieldsChange: () => void;
  onSubmit: (values: GrantFormOutput) => void;
}

export function GrantSmsCreditsForm({
  formId,
  onFieldsChange,
  onSubmit,
}: GrantSmsCreditsFormProps) {
  const { t } = useTranslation('platform');
  // Bangla digits are accepted: normalised to Latin before the checks.
  const grantSchema = React.useMemo(
    () =>
      z.object({
        units: z
          .string()
          .trim()
          .transform(toLatinDigits)
          .refine((value) => /^-?\d+$/.test(value), {
            message: t('schoolDetail.smsCredit.errors.wholeNumber'),
          })
          .refine((value) => Number(value) !== 0, {
            message: t('schoolDetail.smsCredit.errors.notZero'),
          }),
        reason: z.string().trim().min(5, t('schoolDetail.smsCredit.errors.reasonLength')).max(500),
      }),
    [t],
  );
  const form = useForm<GrantFormValues>({
    resolver: zodResolver(grantSchema),
    defaultValues: { units: '', reason: '' },
  });

  function handleSubmit(values: GrantFormValues) {
    onSubmit({ units: Number(values.units), reason: values.reason });
  }

  return (
    <Form {...form}>
      <form
        id={formId}
        noValidate
        onChange={onFieldsChange}
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        <div className="grid gap-4">
          <FormField
            control={form.control}
            name="units"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="grant-sms-units">
                  {t('schoolDetail.smsCredit.unitsLabel')}
                </FormLabel>
                <FormControl>
                  <Input id="grant-sms-units" inputMode="numeric" {...field} />
                </FormControl>
                <FormDescription>{t('schoolDetail.smsCredit.unitsHelp')}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="reason"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="grant-sms-reason">
                  {t('schoolDetail.smsCredit.reasonLabel')}
                </FormLabel>
                <FormControl>
                  <Textarea id="grant-sms-reason" rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </form>
    </Form>
  );
}
