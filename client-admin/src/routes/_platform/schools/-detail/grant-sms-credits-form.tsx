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
 * `onSubmit` here).
 */
import {
  Button,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Textarea,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const grantSchema = z.object({
  units: z
    .string()
    .trim()
    .refine((value) => /^-?\d+$/.test(value), { message: 'Enter a whole number.' })
    .refine((value) => Number(value) !== 0, { message: 'Units must not be zero.' }),
  reason: z.string().trim().min(5).max(500),
});

type GrantFormValues = z.infer<typeof grantSchema>;

export interface GrantFormOutput {
  units: number;
  reason: string;
}

export interface GrantSmsCreditsFormProps {
  submitting: boolean;
  submitError?: string;
  onFieldsChange: () => void;
  onSubmit: (values: GrantFormOutput) => void;
}

export function GrantSmsCreditsForm({
  submitting,
  submitError,
  onFieldsChange,
  onSubmit,
}: GrantSmsCreditsFormProps) {
  const { t } = useTranslation('platform');
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
        className="flex flex-col gap-3 rounded-lg border p-4"
        onChange={onFieldsChange}
        onSubmit={(event) => void form.handleSubmit(handleSubmit)(event)}
      >
        <h3 className="text-sm font-semibold">{t('schoolDetail.smsCredit.grantTitle')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
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
        <div>
          <Button type="submit" loading={submitting}>
            {t('schoolDetail.smsCredit.grantAction')}
          </Button>
        </div>
        {submitError && (
          <p role="alert" className="text-sm text-destructive">
            {submitError}
          </p>
        )}
      </form>
    </Form>
  );
}
