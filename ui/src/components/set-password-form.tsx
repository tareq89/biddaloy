/**
 * 12.2's activation form: set a password once, twice (confirm), submit.
 * Cloned from `sign-in-form.tsx`'s password field (the show/hide toggle,
 * the 44 px hit area, the banner markup) rather than extended — the two
 * forms serve genuinely different moments (signing in vs. setting a
 * password for the first time) and sharing one component would couple
 * them for no reason. `client-admin/src/routes/activate.tsx` owns the
 * `useMutation` calling `ui/src/hooks/auth.ts`'s `activate()`; this
 * component is presentational + validation only, no network.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { Button } from './button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { Input } from './input';
import type { SignInFormError } from './sign-in-form';

export interface SetPasswordFormProps {
  heading: string;
  subtext?: string;
  onSubmit: (password: string) => void;
  loading?: boolean;
  error?: SignInFormError | null;
  submitLabel?: string;
}

interface SetPasswordFormValues {
  password: string;
  confirm: string;
}

/** Decorative, `aria-hidden` — matches `sign-in-form.tsx`'s `AlertIcon`. */
function AlertIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 size-[1.125rem] shrink-0"
    >
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="13.25" r="0.9" fill="currentColor" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      className="mt-0.5 size-[1.125rem] shrink-0"
    >
      <path
        d="M10 5.5v5l3 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/** One password field with the show/hide toggle cloned from
 * `sign-in-form.tsx:206-240` — pulled into its own component here because
 * this form needs two of them (password + confirm) rather than one. */
function PasswordField({
  id,
  label,
  fieldName,
  control,
  loading,
}: {
  id: string;
  label: string;
  fieldName: 'password' | 'confirm';
  control: ReturnType<typeof useForm<SetPasswordFormValues>>['control'];
  loading: boolean;
}) {
  const { t } = useTranslation('auth');
  const [visible, setVisible] = React.useState(false);

  return (
    <FormField
      control={control}
      name={fieldName}
      render={({ field }) => (
        <FormItem>
          <FormLabel htmlFor={id}>{label}</FormLabel>
          {/* See sign-in-form.tsx's own comment on why this wrapper stays
              outside FormControl. */}
          <div className="relative">
            <FormControl>
              <Input
                {...field}
                id={id}
                type={visible ? 'text' : 'password'}
                autoComplete="new-password"
                disabled={loading}
                className="pe-20"
              />
            </FormControl>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={loading}
              aria-pressed={visible}
              aria-controls={id}
              className="absolute end-1 top-1/2 h-[calc(var(--control-h,2rem)-0.25rem)] -translate-y-1/2 after:absolute after:inset-x-0 after:-inset-y-[0.125rem]"
              onClick={() => setVisible((current) => !current)}
            >
              {visible ? t('password.hide') : t('password.show')}
            </Button>
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function SetPasswordForm({
  heading,
  subtext,
  onSubmit,
  loading = false,
  error = null,
  submitLabel,
}: SetPasswordFormProps) {
  const { t } = useTranslation('auth');

  const schema = React.useMemo(
    () =>
      z
        .object({
          password: z.string().min(8, t('setPassword.tooShort')),
          confirm: z.string(),
        })
        .refine((values) => values.password === values.confirm, {
          path: ['confirm'],
          message: t('setPassword.mismatch'),
        }),
    [t],
  );

  const form = useForm<SetPasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  function handleValidSubmit(values: SetPasswordFormValues): void {
    onSubmit(values.password);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(handleValidSubmit)(event)}
        noValidate
        className="flex flex-col gap-6 rounded-lg border border-border-subtle bg-card p-8"
      >
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-xl font-semibold text-balance">{heading}</h1>
          {subtext && <p className="text-sm text-muted-foreground">{subtext}</p>}
        </div>

        {error && (
          <div
            role={error.tone === 'alert' ? 'alert' : 'status'}
            className={cn(
              'flex items-start gap-2.5 rounded-md p-3 text-sm',
              error.tone === 'alert'
                ? 'bg-status-overdue-bg text-status-overdue-fg'
                : 'bg-status-due-bg text-status-due-fg',
            )}
          >
            {error.tone === 'alert' ? <AlertIcon /> : <ClockIcon />}
            <span>{error.message}</span>
          </div>
        )}

        <div className="flex flex-col gap-4">
          <PasswordField
            id="set-password"
            label={t('setPassword.label')}
            fieldName="password"
            control={form.control}
            loading={loading}
          />
          <p className="text-xs text-muted-foreground">{t('setPassword.hint')}</p>
          <PasswordField
            id="set-password-confirm"
            label={t('setPassword.confirmLabel')}
            fieldName="confirm"
            control={form.control}
            loading={loading}
          />
        </div>

        <Button type="submit" loading={loading} className="w-full">
          {loading ? t('setPassword.submitting') : (submitLabel ?? t('setPassword.submit'))}
        </Button>
      </form>
    </Form>
  );
}
