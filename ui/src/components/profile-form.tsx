/**
 * [8.14.4] `/portal/account`'s Profile card — the front end for `PATCH
 * /users/me` (`UserController.updateMe`), the first screen anywhere to
 * consume it. Presentational only, same split `sign-in-form.tsx`
 * documents: no `useQuery`/`useMutation`/router import here — the route
 * (`client-admin/src/routes/portal/account.tsx`) owns `useUpdateOwnProfile`
 * and passes `onSubmit`/`submitting`/`serverError` down.
 *
 * Two server-verified rules this form exists to respect (see the [8.14.4]
 * plan's "Plan corrections" — reading these, not the issue body, is what
 * gets this right):
 *
 * 1. **`current_password` is conditional, not required.** It only appears
 *    once the caller has actually edited `email` or `phone`
 *    (`dirtyFields.email || dirtyFields.phone`) — `UserService
 *    .updateOwnProfile` only asks for it when the *new* value differs from
 *    what's stored, and re-submitting an unchanged value (what saving a
 *    name-only edit does) costs nothing server-side. Showing the field
 *    unconditionally would turn a name typo-fix into an unwanted password
 *    prompt.
 * 2. **Both `email` and `phone` cannot be cleared at once.** The server
 *    maps `''` to `NULL` for both and then refuses to leave the account
 *    with neither identifier — but its 400 message is not written for a
 *    parent to read, so this form blocks that combination itself, with its
 *    own copy, before the request ever goes out.
 *
 * `users.phone` validates against the server's `INTERNATIONAL_PHONE_REGEX`
 * (`users.dto.ts`) — 8-15 digits, optional leading `+`, spaces/`()`/`.`/`-`
 * allowed — a deliberately looser shape than `guardians.phone`'s
 * Bangladesh-only pattern. That's why this field is a plain `Input`, not
 * `PhoneInput` (which validates against a single region's `RegionConfig`
 * shape): a staff member's own account phone is not assumed to be a
 * Bangladeshi mobile number the way a guardian contact number is.
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

/** Mirrors `server/src/modules/users/dto/users.dto.ts`'s
 * `INTERNATIONAL_PHONE_REGEX` exactly — see this file's own header on why
 * this field does not use `PhoneInput`'s single-region validation. */
const INTERNATIONAL_PHONE_REGEX = /^(?=(?:\D*\d){8,15}\D*$)\+?[\d\s().-]+$/;

export interface ProfileFormValues {
  full_name: string;
  email: string;
  phone: string;
}

export interface ProfileFormServerError {
  /** A generic, already-translated message shown above the fields — the
   * fallback for anything not mapped onto a specific field. */
  message?: string;
  fieldErrors?: Partial<Record<'full_name' | 'email' | 'phone' | 'current_password', string>>;
}

export interface ProfileFormSubmitValues {
  full_name: string;
  email: string;
  phone: string;
  /** Present only when the caller edited `email` or `phone` this submit —
   * see this file's header. */
  current_password?: string;
}

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
      z
        .object({
          full_name: z
            .string()
            .trim()
            .min(1, t('account.profile.errors.fullNameRequired'))
            .max(100, t('account.profile.errors.fullNameTooLong')),
          email: z
            .string()
            .trim()
            .max(100, t('account.profile.errors.emailTooLong'))
            .refine(
              (value) => value === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
              t('account.profile.errors.emailInvalid'),
            ),
          phone: z
            .string()
            .trim()
            .max(20, t('account.profile.errors.phoneTooLong'))
            .refine(
              (value) => value === '' || INTERNATIONAL_PHONE_REGEX.test(value),
              t('account.profile.errors.phoneInvalid'),
            ),
          current_password: z.string(),
        })
        .refine((data) => data.email !== '' || data.phone !== '', {
          message: t('account.profile.errors.bothCleared'),
          path: ['email'],
        }),
    [t],
  );

  const form = useForm<ProfileFormValues & { current_password: string }>({
    resolver: zodResolver(schema),
    defaultValues: { ...defaultValues, current_password: '' },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  // Server-side field errors (403 wrong password, 409 email/phone taken)
  // land on the right input the same way a client-side validation error
  // would, rather than only ever showing as the generic banner below.
  React.useEffect(() => {
    if (!serverError?.fieldErrors) return;
    for (const [field, message] of Object.entries(serverError.fieldErrors)) {
      if (message === undefined) continue;
      form.setError(field as keyof ProfileFormSubmitValues, { type: 'server', message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-applying on every render would fight the user's own edits; only a *new* serverError object should re-trigger this.
  }, [serverError]);

  const { dirtyFields } = form.formState;
  const identityChanging = Boolean(dirtyFields.email || dirtyFields.phone);

  function handleValidSubmit(values: ProfileFormValues & { current_password: string }): void {
    if (identityChanging && values.current_password.trim() === '') {
      form.setError('current_password', {
        type: 'required',
        message: t('account.profile.errors.currentPasswordRequired'),
      });
      return;
    }

    onSubmit({
      full_name: values.full_name.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
      ...(identityChanging ? { current_password: values.current_password } : {}),
    });
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

          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-email">{t('account.profile.fields.email')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="account-email"
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
            name="phone"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="account-phone">{t('account.profile.fields.phone')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    id="account-phone"
                    type="tel"
                    autoComplete="tel"
                    disabled={submitting}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {identityChanging && (
            <FormField
              control={form.control}
              name="current_password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="account-current-password">
                    {t('account.profile.fields.currentPassword')}
                  </FormLabel>
                  <p className="text-xs text-muted-foreground">
                    {t('account.profile.currentPasswordHint')}
                  </p>
                  <FormControl>
                    <Input
                      {...field}
                      id="account-current-password"
                      type="password"
                      autoComplete="current-password"
                      disabled={submitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          <Button type="submit" loading={submitting} className="self-start">
            {submitting ? t('account.profile.saving') : t('account.profile.save')}
          </Button>
        </form>
      </Form>
    </Card>
  );
}
