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
import { checkPassword, type PasswordAudience } from '@biddaloy/shared';
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { useInsideAuthLayout } from './auth-layout';
import { Button } from './button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { Input } from './input';
import { FormPasswordChecklist, RuleIcon } from './password-checklist';
import type { SignInFormError } from './sign-in-form';

export interface SetPasswordFormProps {
  heading: string;
  subtext?: string;
  onSubmit: (password: string) => void;
  loading?: boolean;
  error?: SignInFormError | null;
  submitLabel?: string;
  /** Which rules apply; must match what the server enforces for this user. */
  audience?: PasswordAudience;
  /** Renders a ghost button under submit when given. */
  onSkip?: () => void;
  skipLabel?: string;
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
  audience,
}: {
  id: string;
  label: string;
  fieldName: 'password' | 'confirm';
  control: ReturnType<typeof useForm<SetPasswordFormValues>>['control'];
  loading: boolean;
  /** Set on the new-password field to show the live checklist under it. */
  audience?: PasswordAudience;
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
          {audience && <FormPasswordChecklist password={field.value} audience={audience} />}
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
  audience = 'staff',
  onSkip,
  skipLabel,
}: SetPasswordFormProps) {
  const { t } = useTranslation('auth');
  // Inside <AuthLayout> the layout owns the card.
  const framed = !useInsideAuthLayout();

  const schema = React.useMemo(
    () =>
      z
        .object({
          password: z.string(),
          confirm: z.string(),
        })
        // The submit button is disabled until these hold; this is the
        // belt for the braces (e.g. a programmatic submit).
        .superRefine((values, ctx) => {
          const failed = checkPassword(values.password, audience).find((rule) => !rule.ok);
          if (failed) {
            ctx.addIssue({
              code: 'custom',
              path: ['password'],
              message: t(`passwordRules.${failed.id}`),
            });
          }
          if (values.password !== values.confirm) {
            ctx.addIssue({ code: 'custom', path: ['confirm'], message: t('setPassword.mismatch') });
          }
        }),
    [t, audience],
  );

  const form = useForm<SetPasswordFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirm: '' },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  const [password, confirm] = form.watch(['password', 'confirm']);
  const matches = password === confirm;
  const canSubmit = checkPassword(password, audience).every((rule) => rule.ok) && matches;

  function handleValidSubmit(values: SetPasswordFormValues): void {
    onSubmit(values.password);
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(handleValidSubmit)(event)}
        noValidate
        className={cn(
          'flex flex-col gap-6',
          framed && 'rounded-lg border border-border-subtle bg-card p-8',
        )}
      >
        <div>
          <h1 className="text-h1 text-balance">{heading}</h1>
          {subtext && <p className="mt-0.5 text-text-secondary">{subtext}</p>}
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
            audience={audience}
          />
          <PasswordField
            id="set-password-confirm"
            label={t('setPassword.confirmLabel')}
            fieldName="confirm"
            control={form.control}
            loading={loading}
          />
          {confirm !== '' && (
            <p
              aria-live="polite"
              className={cn(
                'flex items-center gap-2 text-xs',
                matches ? 'text-status-paid-fg' : 'text-status-overdue-fg',
              )}
            >
              {matches ? <RuleIcon ok /> : <AlertIcon />}
              <span>{matches ? t('setPassword.match') : t('setPassword.mismatch')}</span>
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <Button type="submit" loading={loading} disabled={!canSubmit} className="w-full">
            {loading ? t('setPassword.submitting') : (submitLabel ?? t('setPassword.submit'))}
          </Button>
          {onSkip && (
            <Button
              type="button"
              variant="ghost"
              disabled={loading}
              onClick={onSkip}
              className="w-full"
            >
              {skipLabel ?? t('setPassword.skip')}
            </Button>
          )}
        </div>
      </form>
    </Form>
  );
}
