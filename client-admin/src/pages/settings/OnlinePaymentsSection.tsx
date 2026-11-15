/**
 * [Epic 3 / #3977, #3995] "Online payments" settings card. Proof half: whether guardians may
 * upload payment proofs, and per allowed method the "how to pay" text they see. bKash half
 * (#3995): the four write-only merchant secrets + environment, "Test connection" and the
 * "Allow online payments" switch. It PATCHes `payments.proofEnabled` + `payments.proofMethods`
 * always (same partial-save shape as `FeesSection`) and `bkash.*` / `onlineEnabled` only when
 * the admin changed them. Secrets live in local state, never in the form or the DOM (D13/D14).
 */
import { PaymentGatewayEnvironment, PaymentMethod } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Checkbox,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@biddaloy/ui/components';
import {
  useTestBkashConnection,
  useUpdateSchoolSettings,
  type MaskedSecret,
  type TenantSettingsInput,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useFormShellMode, useWarnUnsavedChanges } from '@biddaloy/ui/shells';
import { formatDateTime } from '@biddaloy/ui/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { PlugZapIcon } from 'lucide-react';
import * as React from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { z } from 'zod';

import { SecretField } from '../../components/SecretField';

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
  onlineEnabled?: boolean | undefined;
  /** Secrets come back masked (`{ configured, hint? }`), never plain. */
  bkash?:
    | {
        environment?: string | undefined;
        lastTestOkAt?: string | undefined;
        appKey?: unknown;
        appSecret?: unknown;
        username?: unknown;
        password?: unknown;
      }
    | undefined;
}

/** The four merchant secrets, in the order the bKash merchant panel lists them. */
const BKASH_SECRETS = ['username', 'password', 'appKey', 'appSecret'] as const;
type BkashSecretKey = (typeof BKASH_SECRETS)[number];
type BkashSecrets = Partial<Record<BkashSecretKey, string | null>>;
type BkashPatch = NonNullable<NonNullable<TenantSettingsInput['payments']>['bkash']>;

const buildSchema = (tooLong: string) =>
  z.object({
    proofEnabled: z.boolean(),
    onlineEnabled: z.boolean(),
    environment: z.string(),
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
    onlineEnabled: payments?.onlineEnabled ?? false,
    environment: payments?.bkash?.environment ?? PaymentGatewayEnvironment.SANDBOX,
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
  const updateSettings = useUpdateSchoolSettings(schoolId);
  const testBkash = useTestBkashConnection();
  const regionConfig = useRegionConfig();
  // undefined = untouched, null = cleared, string = new value (SecretField's contract).
  const [secrets, setSecrets] = React.useState<BkashSecrets>({});
  // A save that changed a credential voids the last passing test until a new one passes (D13).
  const [voided, setVoided] = React.useState(false);

  const environment = form.watch('environment');
  const envChanged = environment !== (form.formState.defaultValues?.environment ?? environment);
  const credentialsChanged = envChanged || BKASH_SECRETS.some((k) => secrets[k] !== undefined);
  const tested = testBkash.isSuccess || (!voided && !!payments?.bkash?.lastTestOkAt);
  const lastTestOkAt = testBkash.data?.lastTestOkAt ?? payments?.bkash?.lastTestOkAt;
  const onlineValue = form.watch('onlineEnabled');
  // Credentials just edited: the server will switch online off on save, so show it off now.
  const onlineShown = onlineValue && !credentialsChanged;
  const canToggleOnline = (tested && !credentialsChanged) || onlineShown;
  useWarnUnsavedChanges(form.formState.isDirty || credentialsChanged);

  function handleSave(values: Values) {
    const bkash: BkashPatch = {};
    // An environment is always saved with the secrets: the server cannot test without one.
    const secretsChanged = BKASH_SECRETS.some((k) => secrets[k] !== undefined);
    if (envChanged || (secretsChanged && !payments?.bkash?.environment))
      bkash.environment = values.environment as PaymentGatewayEnvironment;
    // `null` removes a saved secret: the server's @IsOptional lets it through and the merge
    // deletes the key (the DTO type just doesn't spell it).
    for (const k of BKASH_SECRETS) if (secrets[k] !== undefined) bkash[k] = secrets[k] as string;
    const sendBkash = Object.keys(bkash).length > 0;
    const onlineChanged = values.onlineEnabled !== form.formState.defaultValues?.onlineEnabled;
    const submittedSecrets = secrets;
    updateSettings.mutate(
      {
        version: 1,
        payments: {
          ...(sendBkash ? { bkash } : {}),
          ...(onlineChanged && !credentialsChanged ? { onlineEnabled: values.onlineEnabled } : {}),
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
      {
        onSuccess: () => {
          if (sendBkash) {
            // keep anything typed while the save was in flight
            setSecrets((prev) =>
              Object.fromEntries(Object.entries(prev).filter(([k, v]) => submittedSecrets[k as BkashSecretKey] !== v)),
            );
            setVoided(true);
            testBkash.reset();
          }
          form.reset(
            { ...values, onlineEnabled: values.onlineEnabled && !credentialsChanged },
            { keepIsSubmitSuccessful: true },
          );
        },
      },
    );
  }

  function runTest() {
    testBkash.mutate(undefined, { onSuccess: () => setVoided(false) });
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

        <h3 className="mt-6 border-t border-border-subtle pt-4 text-h3">
          {t('onlinePayments.bkash.title')}
        </h3>
        <p className="mt-1 text-text-secondary">{t('onlinePayments.bkash.intro')}</p>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <FormField
            control={form.control}
            name="environment"
            render={({ field }) => (
              <FormItem className="md:col-span-2">
                <FormLabel htmlFor="online-payments-environment">
                  {t('onlinePayments.bkash.environment')}
                </FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger id="online-payments-environment">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={PaymentGatewayEnvironment.SANDBOX}>
                      {t('onlinePayments.bkash.sandbox')}
                    </SelectItem>
                    <SelectItem value={PaymentGatewayEnvironment.PRODUCTION}>
                      {t('onlinePayments.bkash.production')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FormDescription>{t('help.bkash.environment')}</FormDescription>
              </FormItem>
            )}
          />
          {BKASH_SECRETS.map((key) => (
            <SecretField
              key={key}
              id={`online-payments-bkash-${key}`}
              label={t(`onlinePayments.bkash.${key}`)}
              masked={payments?.bkash?.[key] as MaskedSecret | undefined}
              value={secrets[key]}
              onChange={(v) => setSecrets((prev) => ({ ...prev, [key]: v }))}
              description={t(`help.bkash.${key}`)}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-center">
          <Button
            type="button"
            variant="outline"
            className="w-full md:w-auto"
            loading={testBkash.isPending}
            disabled={credentialsChanged}
            onClick={runTest}
          >
            <PlugZapIcon aria-hidden="true" />
            {t('testConnection.action')}
          </Button>
          {credentialsChanged && (
            <p className="text-caption text-text-secondary">
              {t('onlinePayments.bkash.saveFirst')}
            </p>
          )}
          {!credentialsChanged && testBkash.isError && (
            <p role="alert" className="text-destructive">
              {t(
                testBkash.error instanceof ApiError && testBkash.error.statusCode === 400
                  ? 'onlinePayments.bkash.testMissing'
                  : 'onlinePayments.bkash.testFailed',
              )}
            </p>
          )}
          {!credentialsChanged && tested && lastTestOkAt && (
            <p role="status" className="text-text-secondary">
              {t('onlinePayments.bkash.testOk', {
                at: formatDateTime(lastTestOkAt, regionConfig),
              })}
            </p>
          )}
        </div>
        <FormField
          control={form.control}
          name="onlineEnabled"
          render={({ field }) => (
            <FormItem className="mt-4 flex min-h-11 flex-row items-center justify-between gap-3">
              <div className="flex flex-1 flex-col">
                <FormLabel htmlFor="online-payments-onlineEnabled">
                  {t('onlinePayments.bkash.onlineEnabled')}
                </FormLabel>
                <FormDescription>
                  {t(
                    canToggleOnline ? 'help.bkash.onlineEnabled' : 'onlinePayments.bkash.testFirst',
                  )}
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  id="online-payments-onlineEnabled"
                  checked={onlineShown}
                  disabled={!canToggleOnline}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
            </FormItem>
          )}
        />
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
