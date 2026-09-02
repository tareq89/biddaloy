/**
 * [8.14.4] `/portal/account`'s guardian-contact card — the front end for
 * `PATCH /guardians/mine` (`StudentController.updateMyGuardian`),
 * PARENT-only. These are the numbers `SingleReminderService`/
 * `BulkReminderService` actually dial, so a stale one here is the parent's
 * own reminders going to the wrong place — fixing it themselves rather
 * than calling the school office is this card's whole reason to exist.
 *
 * Presentational only — same split `profile-form.tsx` documents: the route
 * owns `useMyGuardian`/`useUpdateMyGuardian`.
 *
 * **The phone regex is not the same one `profile-form.tsx` uses.**
 * `guardians.phone`/`alternate_phone` validate against the server's
 * Bangladesh-only `BD_PHONE_REGEX` (`students.dto.ts`):
 * `/^(?:\+?880|0)1[3-9]\d{8}$/` — a full national number with a leading
 * `+880`/`880`/`0`, not the 8-15-digit free shape `users.phone` accepts.
 * `PhoneInput` already validates a *national* number (its own `config`
 * strips the country code/trunk `0` before checking `config.phone
 * .pattern`), so submission normalizes whatever the user typed into a
 * single canonical `+880XXXXXXXXXX` form via `parsePhone` — guaranteed to
 * satisfy `BD_PHONE_REGEX` regardless of whether the user typed a leading
 * `0`, `+880`, or nothing at all.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useTranslation, type RegionConfig } from '../i18n';
import { parsePhone } from '../utils/phone';

import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { Input } from './input';
import { PhoneInput } from './phone-input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

const PREFERRED_COMMUNICATION_OPTIONS = [
  'SMS',
  'WHATSAPP',
  'EMAIL',
  'PHONE_CALL',
  'MESSENGER',
] as const;

export type GuardianPreferredCommunication = (typeof PREFERRED_COMMUNICATION_OPTIONS)[number];

export interface GuardianContactFormValues {
  phone: string;
  alternate_phone: string;
  email: string;
  preferred_communication: GuardianPreferredCommunication;
  notifications_enabled: boolean;
}

export interface GuardianContactFormServerError {
  message?: string;
  fieldErrors?: Partial<Record<'phone' | 'alternate_phone' | 'email', string>>;
}

export interface GuardianContactFormProps {
  defaultValues: GuardianContactFormValues;
  config: RegionConfig;
  onSubmit: (values: GuardianContactFormValues) => void;
  submitting?: boolean;
  serverError?: GuardianContactFormServerError | null;
}

/** Normalizes whatever `PhoneInput` handed back into the one shape
 * `BD_PHONE_REGEX` always accepts. `''` passes through unchanged — an
 * empty phone/alternate_phone is a valid "not set" value the server maps
 * to `NULL`, not something to normalize. */
function toCanonicalPhone(value: string, config: RegionConfig): string {
  if (value === '') return '';
  const result = parsePhone(value, config);
  return result.valid ? `+${config.phone.country}${result.value}` : value;
}

export function GuardianContactForm({
  defaultValues,
  config,
  onSubmit,
  submitting = false,
  serverError = null,
}: GuardianContactFormProps) {
  const { t } = useTranslation('portal');

  const schema = React.useMemo(
    () =>
      z.object({
        phone: z
          .string()
          .refine(
            (value) => value === '' || parsePhone(value, config).valid,
            t('account.guardian.errors.phoneInvalid'),
          ),
        alternate_phone: z
          .string()
          .refine(
            (value) => value === '' || parsePhone(value, config).valid,
            t('account.guardian.errors.phoneInvalid'),
          ),
        email: z
          .string()
          .trim()
          .refine(
            (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
            t('account.guardian.errors.emailInvalid'),
          ),
        preferred_communication: z.enum(PREFERRED_COMMUNICATION_OPTIONS),
        notifications_enabled: z.boolean(),
      }),
    [config, t],
  );

  const form = useForm<GuardianContactFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  React.useEffect(() => {
    if (!serverError?.fieldErrors) return;
    for (const [field, message] of Object.entries(serverError.fieldErrors)) {
      if (message === undefined) continue;
      form.setError(field as keyof GuardianContactFormValues, { type: 'server', message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see profile-form.tsx's identical comment
  }, [serverError]);

  function handleValidSubmit(values: GuardianContactFormValues): void {
    onSubmit({
      ...values,
      phone: toCanonicalPhone(values.phone.trim(), config),
      alternate_phone: toCanonicalPhone(values.alternate_phone.trim(), config),
      email: values.email.trim(),
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">{t('account.guardian.title')}</h2>
      <p className="text-xs text-muted-foreground">{t('account.guardian.explanation')}</p>
      {serverError?.message && (
        <p role="alert" className="text-sm text-destructive">
          {serverError.message}
        </p>
      )}
      <Form {...form}>
        <form
          onSubmit={(event) => void form.handleSubmit(handleValidSubmit)(event)}
          noValidate
          className="flex flex-col gap-4"
        >
          <FormField
            control={form.control}
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-guardian-phone">
                  {t('account.guardian.fields.phone')}
                </FormLabel>
                <FormControl>
                  <PhoneInput
                    {...field}
                    id="account-guardian-phone"
                    config={config}
                    disabled={submitting}
                    onValueChange={(value) => field.onChange(value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="alternate_phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-guardian-alternate-phone">
                  {t('account.guardian.fields.alternatePhone')}
                </FormLabel>
                <FormControl>
                  <PhoneInput
                    {...field}
                    id="account-guardian-alternate-phone"
                    config={config}
                    disabled={submitting}
                    onValueChange={(value) => field.onChange(value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-guardian-email">
                  {t('account.guardian.fields.email')}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="account-guardian-email"
                    type="email"
                    autoComplete="email"
                    disabled={submitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="preferred_communication"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-guardian-preferred-communication">
                  {t('account.guardian.fields.preferredCommunication')}
                </FormLabel>
                <FormControl>
                  <Select value={field.value} onValueChange={field.onChange} disabled={submitting}>
                    <SelectTrigger id="account-guardian-preferred-communication">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PREFERRED_COMMUNICATION_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {t(`account.guardian.preferredCommunicationOptions.${option}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex items-start gap-2">
            <Checkbox
              id="account-guardian-notifications-enabled"
              checked={form.watch('notifications_enabled')}
              onCheckedChange={(checked) =>
                form.setValue('notifications_enabled', checked === true, { shouldDirty: true })
              }
              disabled={submitting}
            />
            <label
              htmlFor="account-guardian-notifications-enabled"
              className="text-sm text-muted-foreground"
            >
              {t('account.guardian.fields.notificationsEnabled')}
            </label>
          </div>

          <Button type="submit" loading={submitting} className="self-start">
            {submitting ? t('account.guardian.saving') : t('account.guardian.save')}
          </Button>
        </form>
      </Form>
    </Card>
  );
}
