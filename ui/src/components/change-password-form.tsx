/**
 * [8.14.4] `/portal/account`'s password card — the front end for `POST
 * /auth/change-password` (`AuthController.changePassword`). Presentational
 * only, same split `profile-form.tsx` documents: the route owns
 * `changePassword()` (`ui/src/hooks/auth.ts`).
 *
 * The new-password rules are the shared `checkPassword(…, audience)` ones —
 * the same functions the server enforces — shown live by `PasswordChecklist`.
 * Everything else is the server's call, surfaced back through `serverError`.
 *
 * `current_password`/`new_password` use `autoComplete="current-password"`/
 * `"new-password"` respectively, same as `sign-in-form.tsx`'s single
 * password field — the browser's own password manager is what actually
 * offers to save/suggest a strong replacement here, not anything this form
 * renders itself.
 */
import { checkPassword, type PasswordAudience, type PasswordRuleId } from '@biddaloy/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import { CircleAlertIcon, InfoIcon } from 'lucide-react';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useTranslation } from '../i18n';

import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { Input } from './input';
import { FormPasswordChecklist } from './password-checklist';

export interface ChangePasswordFormValues {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export interface ChangePasswordFormServerError {
  message?: string;
  /** `'current_password'` carries the 403 "that password is not correct"
   * case (plan correction 4) — the only field the server ever actually
   * complains about, since there is no strength policy to violate. */
  fieldErrors?: Partial<Record<'current_password', string>>;
}

export interface ChangePasswordFormProps {
  onSubmit: (values: { current_password: string; new_password: string }) => void;
  submitting?: boolean;
  serverError?: ChangePasswordFormServerError | null;
  /** Which rules apply; must match what the server enforces for this user. */
  audience?: PasswordAudience;
  /** Server-rejected rules for the last submitted password (`weakPasswordRules`). */
  failedRules?: PasswordRuleId[] | undefined;
}

export function ChangePasswordForm({
  onSubmit,
  submitting = false,
  serverError = null,
  audience = 'staff',
  failedRules,
}: ChangePasswordFormProps) {
  const { t } = useTranslation('portal');
  const { t: tAuth } = useTranslation('auth');
  const [showPasswords, setShowPasswords] = React.useState(false);

  const schema = React.useMemo(
    () =>
      z
        .object({
          current_password: z.string().min(1, t('account.password.errors.currentRequired')),
          new_password: z.string().min(1, t('account.password.errors.newRequired')),
          confirm_password: z.string().min(1, t('account.password.errors.confirmRequired')),
        })
        .superRefine((data, ctx) => {
          const failed = checkPassword(data.new_password, audience).find((rule) => !rule.ok);
          if (data.new_password !== '' && failed) {
            ctx.addIssue({
              code: 'custom',
              path: ['new_password'],
              message: tAuth(`passwordRules.${failed.id}`),
            });
          }
          if (data.new_password !== data.confirm_password) {
            ctx.addIssue({
              code: 'custom',
              path: ['confirm_password'],
              message: t('account.password.errors.mismatch'),
            });
          }
        }),
    [t, tAuth, audience],
  );

  const form = useForm<ChangePasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { current_password: '', new_password: '', confirm_password: '' },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  React.useEffect(() => {
    if (!serverError?.fieldErrors) return;
    for (const [field, message] of Object.entries(serverError.fieldErrors)) {
      if (message === undefined) continue;
      form.setError(field as keyof ChangePasswordFormValues, { type: 'server', message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see profile-form.tsx's identical comment
  }, [serverError]);

  const submitted = React.useRef('');

  function handleValidSubmit(values: ChangePasswordFormValues): void {
    submitted.current = values.new_password;
    onSubmit({ current_password: values.current_password, new_password: values.new_password });
  }

  const passwordType = showPasswords ? 'text' : 'password';

  return (
    <Card padded>
      <h2 className="text-h2">{t('account.password.title')}</h2>
      {serverError?.message && (
        <p role="alert" className="mt-3 flex items-center gap-1 text-caption text-destructive">
          <CircleAlertIcon className="size-4" aria-hidden="true" />
          {serverError.message}
        </p>
      )}
      <Form {...form}>
        <form onSubmit={(event) => void form.handleSubmit(handleValidSubmit)(event)} noValidate>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FormField
              control={form.control}
              name="current_password"
              render={({ field }) => (
                <FormItem className="md:col-span-2">
                  <FormLabel htmlFor="account-change-current-password">
                    {t('account.password.fields.current')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id="account-change-current-password"
                      type={passwordType}
                      autoComplete="current-password"
                      disabled={submitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="new_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="account-change-new-password">
                    {t('account.password.fields.new')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id="account-change-new-password"
                      type={passwordType}
                      autoComplete="new-password"
                      disabled={submitting}
                    />
                  </FormControl>
                  <FormPasswordChecklist
                    password={field.value}
                    audience={audience}
                    failed={field.value === submitted.current ? failedRules : undefined}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="confirm_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="account-change-confirm-password">
                    {t('account.password.fields.confirm')}
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      id="account-change-confirm-password"
                      type={passwordType}
                      autoComplete="new-password"
                      disabled={submitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex min-h-11 items-center gap-3 md:col-span-2">
              <Checkbox
                id="account-change-show-passwords"
                checked={showPasswords}
                onCheckedChange={(checked) => setShowPasswords(checked === true)}
                disabled={submitting}
              />
              <label htmlFor="account-change-show-passwords" className="text-text-primary">
                {showPasswords ? t('account.password.hide') : t('account.password.show')}
              </label>
            </div>

            {/* [8.14.4] plan's "persistent, non-dismissible consequence
              notice" — every other device is signed out the moment this
              succeeds, so it says so before the button is even pressed,
              not only after. */}
            <p className="flex items-start gap-2 rounded-md bg-status-due-bg px-3 py-2 text-status-due-fg md:col-span-2">
              <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {t('account.password.consequenceNotice')}
            </p>
          </div>

          <div className="mt-4 flex justify-end border-t border-border-subtle pt-4">
            <Button type="submit" loading={submitting} className="w-full md:w-auto">
              {submitting ? t('account.password.saving') : t('account.password.save')}
            </Button>
          </div>
        </form>
      </Form>
    </Card>
  );
}
