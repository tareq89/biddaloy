/**
 * [Epic 3 / #3977] "Online payments" settings card, proof half: whether guardians may upload
 * payment proofs, and per allowed method the "how to pay" text they see. It PATCHes only
 * `payments.proofEnabled` + `payments.proofMethods` (same partial-save shape as `FeesSection`);
 * the bKash credentials and `onlineEnabled` belong to #3995 and are never read or sent here.
 */
import { PaymentMethod } from '@biddaloy/shared';
import {
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Switch,
} from '@biddaloy/ui/components';
import { useUpdateSchoolSettings } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

import { SettingsSaved, SettingsSection } from './settings-layout';
import { SettingsMutationError } from './settings-mutation-error';

export const INSTRUCTIONS_MAX = 500;

/** Methods a guardian can pay by hand and then send a proof for (cash/cheque/card have no transaction to prove). */
export const PROOF_METHODS = [
  PaymentMethod.BKASH,
  PaymentMethod.NAGAD,
  PaymentMethod.ROCKET,
  PaymentMethod.BANK_TRANSFER,
] as const;

/** The slice of `settings.payments` this card reads; `schema.d.ts` has the same fields. */
export interface ProofPaymentsSettings {
  proofEnabled?: boolean | undefined;
  proofMethods?: { method: string; instructions: string }[] | undefined;
}

const buildSchema = (tooLong: string) =>
  z.object({
    proofEnabled: z.boolean(),
    methods: z.record(
      z.string(),
      z
        .object({ enabled: z.boolean(), instructions: z.string() })
        // Only an enabled method is saved, so only its instructions are length-checked.
        .superRefine((row, ctx) => {
          if (row.enabled && row.instructions.length > INSTRUCTIONS_MAX) {
            ctx.addIssue({ code: 'custom', path: ['instructions'], message: tooLong });
          }
        }),
    ),
  });
type Values = z.infer<ReturnType<typeof buildSchema>>;

function toFormValues(payments: ProofPaymentsSettings | undefined): Values {
  return {
    proofEnabled: payments?.proofEnabled ?? false,
    methods: Object.fromEntries(
      PROOF_METHODS.map((method) => {
        const saved = payments?.proofMethods?.find((m) => String(m.method) === String(method));
        return [method, { enabled: saved !== undefined, instructions: saved?.instructions ?? '' }];
      }),
    ),
  };
}

interface OnlinePaymentsSectionProps {
  schoolId: string;
  payments: ProofPaymentsSettings | undefined;
}

export function OnlinePaymentsSection({ schoolId, payments }: OnlinePaymentsSectionProps) {
  const { t } = useTranslation('settings');
  const form = useForm<Values>({
    resolver: zodResolver(buildSchema(t('onlinePayments.tooLong', { max: INSTRUCTIONS_MAX }))),
    defaultValues: toFormValues(payments),
    ...useFormShellMode(),
  });
  useWarnUnsavedChanges(form.formState.isDirty);
  const updateSettings = useUpdateSchoolSettings(schoolId);

  function handleSave(values: Values) {
    updateSettings.mutate(
      {
        version: 1,
        payments: {
          proofEnabled: values.proofEnabled,
          proofMethods: [
            ...PROOF_METHODS.filter((m) => values.methods[m]?.enabled).map((method) => ({
              method,
              instructions: values.methods[method]?.instructions ?? '',
            })),
            // Methods this card doesn't offer (CASH/CHEQUE/CARD) are carried over, never dropped.
            ...(payments?.proofMethods ?? [])
              .filter((m) => !PROOF_METHODS.some((p) => String(p) === String(m.method)))
              .map((m) => ({ ...m, method: m.method as PaymentMethod })),
          ],
        },
      },
      { onSuccess: () => form.reset(values, { keepIsSubmitSuccessful: true }) },
    );
  }

  return (
    <Form {...form}>
      <SettingsSection
        id="online-payments-section"
        title={t('onlinePayments.title')}
        description={t('onlinePayments.description')}
        onSubmit={(event) => void form.handleSubmit(handleSave)(event)}
        saving={updateSettings.isPending}
        footerStart={
          <>
            {updateSettings.isSuccess && <SettingsSaved />}
            {updateSettings.isError && <SettingsMutationError error={updateSettings.error} />}
          </>
        }
      >
        <FormField
          control={form.control}
          name="proofEnabled"
          render={({ field }) => (
            <FormItem className="mt-4 flex min-h-11 flex-row items-center justify-between gap-3">
              <div className="flex flex-1 flex-col">
                <FormLabel htmlFor="online-payments-proofEnabled">
                  {t('onlinePayments.proofEnabled')}
                </FormLabel>
                <FormDescription>{t('help.proofEnabled')}</FormDescription>
              </div>
              <FormControl>
                <Switch
                  id="online-payments-proofEnabled"
                  checked={field.value}
                  disabled={updateSettings.isPending}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />

        <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
          {t('onlinePayments.methodsTitle')}
        </h3>
        <p className="mt-1 text-text-secondary">{t('onlinePayments.methodsIntro')}</p>
        <ul className="mt-2 divide-y divide-border-subtle">
          {PROOF_METHODS.map((method) => (
            <MethodRow key={method} method={method} form={form} saving={updateSettings.isPending} />
          ))}
        </ul>
        {/* The bKash connection card (#3995) is intentionally absent in this wave. */}
      </SettingsSection>
    </Form>
  );
}

function MethodRow({
  method,
  form,
  saving,
}: {
  method: (typeof PROOF_METHODS)[number];
  form: UseFormReturn<Values>;
  saving: boolean;
}) {
  const { t } = useTranslation('settings');
  const row = form.watch(`methods.${method}`);
  const label = t(`onlinePayments.methods.${method}`);
  const over = row.instructions.length > INSTRUCTIONS_MAX;
  return (
    <li className="py-2">
      <FormField
        control={form.control}
        name={`methods.${method}.enabled`}
        render={({ field }) => (
          <FormItem className="flex min-h-11 flex-row items-center gap-3 md:min-h-8">
            <FormControl>
              <Checkbox
                id={`online-payments-${method}-enabled`}
                checked={field.value}
                disabled={saving}
                onCheckedChange={(checked) => field.onChange(checked === true)}
              />
            </FormControl>
            <FormLabel
              htmlFor={`online-payments-${method}-enabled`}
              className="flex-1 self-stretch"
            >
              {label}
            </FormLabel>
          </FormItem>
        )}
      />
      {row.enabled && (
        <div className="mt-1 flex flex-col gap-2 md:ms-7">
          <FormField
            control={form.control}
            name={`methods.${method}.instructions`}
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor={`online-payments-${method}-instructions`}>
                  {t('onlinePayments.instructionsLabel')}
                </FormLabel>
                <FormControl>
                  <Input
                    id={`online-payments-${method}-instructions`}
                    {...field}
                    disabled={saving}
                  />
                </FormControl>
                <FormDescription className={over ? 'text-destructive' : undefined}>
                  {t('onlinePayments.counter', {
                    count: row.instructions.length,
                    max: INSTRUCTIONS_MAX,
                  })}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="rounded-md border border-border-subtle bg-muted p-3">
            <p className="text-caption text-text-secondary">{t('onlinePayments.preview')}</p>
            <p className="mt-1 font-medium">{label}</p>
            <p className="break-words whitespace-pre-wrap" data-testid={`preview-${method}`}>
              {row.instructions || t('onlinePayments.previewEmpty')}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}
