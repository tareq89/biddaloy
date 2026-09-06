/**
 * [8.14.4] `/portal/account`'s Profile card — the front end for `PATCH
 * /users/me` (`UserController.updateMe`). Presentational only, same split
 * `sign-in-form.tsx` documents: no `useQuery`/`useMutation`/router import
 * here — the route (`client-admin/src/routes/portal/account.tsx`) owns
 * `useUpdateOwnProfile` and passes `onSubmit`/`submitting`/`serverError`
 * down.
 *
 * [12.7]: `full_name` only. Email/phone used to live here too, gated
 * behind a re-typed `current_password` — that whole flow is gone.
 * `PATCH /users/me` no longer accepts either field at all (a 400 if it
 * still does), because changing your own contact now goes through a
 * commit-on-verify flow instead (`ContactChangeDialog` +
 * `useRequestContactChange`/`useConfirmPhoneChange`) that only writes the
 * new value once it's proven owned — a stronger guarantee than "you typed
 * your password" ever was. The route renders email/phone read-only with
 * a verified/unverified label and a "Change" button each; this form has
 * nothing to say about either any more.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useTranslation } from '../i18n';

import { Button } from './button';
import { Card } from './card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { Input } from './input';

export interface ProfileFormValues {
  full_name: string;
}

export interface ProfileFormServerError {
  /** A generic, already-translated message shown above the fields — the
   * fallback for anything not mapped onto a specific field. */
  message?: string;
  fieldErrors?: Partial<Record<'full_name', string>>;
}

export type ProfileFormSubmitValues = ProfileFormValues;

export interface ProfileFormProps {
  defaultValues: ProfileFormValues;
  onSubmit: (values: ProfileFormSubmitValues) => void;
  submitting?: boolean;
  serverError?: ProfileFormServerError | null;
}

export function ProfileForm({
  defaultValues,
  onSubmit,
  submitting = false,
  serverError = null,
}: ProfileFormProps) {
  const { t } = useTranslation('portal');

  const schema = React.useMemo(
    () =>
      z.object({
        full_name: z
          .string()
          .trim()
          .min(1, t('account.profile.errors.fullNameRequired'))
          .max(100, t('account.profile.errors.fullNameTooLong')),
      }),
    [t],
  );

  const form = useForm<ProfileFormValues>({
    resolver: zodResolver(schema),
    defaultValues,
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  // Server-side field errors land on the right input the same way a
  // client-side validation error would, rather than only ever showing as
  // the generic banner below.
  React.useEffect(() => {
    if (!serverError?.fieldErrors) return;
    for (const [field, message] of Object.entries(serverError.fieldErrors)) {
      if (message === undefined) continue;
      form.setError(field as keyof ProfileFormValues, { type: 'server', message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-applying on every render would fight the user's own edits; only a *new* serverError object should re-trigger this.
  }, [serverError]);

  function handleValidSubmit(values: ProfileFormValues): void {
    onSubmit({ full_name: values.full_name.trim() });
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">{t('account.profile.title')}</h2>
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
            name="full_name"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-full-name">
                  {t('account.profile.fields.fullName')}
                </FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="account-full-name"
                    autoComplete="name"
                    disabled={submitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" loading={submitting} className="self-start">
            {submitting ? t('account.profile.saving') : t('account.profile.save')}
          </Button>
        </form>
      </Form>
    </Card>
  );
}
