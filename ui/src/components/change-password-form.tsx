/**
 * [8.14.4] `/portal/account`'s password card — the front end for `POST
 * /auth/change-password` (`AuthController.changePassword`). Presentational
 * only, same split `profile-form.tsx` documents: the route owns
 * `changePassword()` (`ui/src/hooks/auth.ts`).
 *
 * The server has **no** password-strength policy (`ChangePasswordDto`'s own
 * header comment) — this form does not invent one. The only client-side
 * rule is "non-empty, and the confirm field matches"; everything else is
 * the server's call, surfaced back through `serverError`.
 *
 * `current_password`/`new_password` use `autoComplete="current-password"`/
 * `"new-password"` respectively, same as `sign-in-form.tsx`'s single
 * password field — the browser's own password manager is what actually
 * offers to save/suggest a strong replacement here, not anything this form
 * renders itself.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useTranslation } from '../i18n';

import { Button } from './button';
import { Card } from './card';
import { Checkbox } from './checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { Input } from './input';

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
}

export function ChangePasswordForm({
  onSubmit,
  submitting = false,
  serverError = null,
}: ChangePasswordFormProps) {
  const { t } = useTranslation('portal');
  const [showPasswords, setShowPasswords] = React.useState(false);

  const schema = React.useMemo(
    () =>
      z
        .object({
          current_password: z.string().min(1, t('account.password.errors.currentRequired')),
          new_password: z.string().min(1, t('account.password.errors.newRequired')),
          confirm_password: z.string().min(1, t('account.password.errors.confirmRequired')),
        })
        .refine((data) => data.new_password === data.confirm_password, {
          message: t('account.password.errors.mismatch'),
          path: ['confirm_password'],
        }),
    [t],
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

  function handleValidSubmit(values: ChangePasswordFormValues): void {
    onSubmit({ current_password: values.current_password, new_password: values.new_password });
  }

  const passwordType = showPasswords ? 'text' : 'password';

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">{t('account.password.title')}</h2>
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
            name="current_password"
            render={({ field }) => (
              <FormItem>
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

          <div className="flex items-center gap-2">
            <Checkbox
              id="account-change-show-passwords"
              checked={showPasswords}
              onCheckedChange={(checked) => setShowPasswords(checked === true)}
              disabled={submitting}
            />
            <label
              htmlFor="account-change-show-passwords"
              className="text-xs text-muted-foreground"
            >
              {showPasswords ? t('account.password.hide') : t('account.password.show')}
            </label>
          </div>

          {/* [8.14.4] plan's "persistent, non-dismissible consequence
              notice" — every other device is signed out the moment this
              succeeds, so it says so before the button is even pressed,
              not only after. */}
          <p className="rounded-md bg-status-due-bg p-3 text-xs text-status-due-fg">
            {t('account.password.consequenceNotice')}
          </p>

          <Button type="submit" loading={submitting} className="self-start">
            {submitting ? t('account.password.saving') : t('account.password.save')}
          </Button>
        </form>
      </Form>
    </Card>
  );
}
