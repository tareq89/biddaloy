/**
 * The living version of the "Biddaloy Client UI" design project's
 * `templates/sign-in` mockup ([8.9.4], approved before this file existed —
 * see `ui/CONTRIBUTING.md`'s "Design before you build"). Presentational and
 * validation only, no network: `client-admin/src/routes/login.tsx` owns the
 * `useMutation` calling `ui/src/hooks/auth.ts`'s `login()` and the redirect
 * on success, so this component (and its Storybook states below) stays the
 * one thing both `client-admin` and a future `client-student` sign-in page
 * can share.
 *
 * One field, not two: the mockup's whole point is that a user shouldn't
 * have to decide "is this my email or my phone?" themselves —
 * `detectLoginIdentifier` (`ui/src/utils/login-identifier.ts`) does that,
 * against the active `RegionConfig` so phone-shape validation matches
 * whichever region a locale-only, pre-tenant login page can know about
 * (see `login.tsx`'s own comment on why `RegionConfigProvider` gets no
 * `value` override here).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { useRegionConfig, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { detectLoginIdentifier } from '../utils';

import { Button } from './button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from './form-field';
import { Input } from './input';

export type SignInCredentials = ({ email: string } | { phone: string }) & { password: string };

export interface SignInFormError {
  message: string;
  /** `'status'` for the calm, non-alarming rate-limit case the AC asks
   * for; `'alert'` for an actual failure (wrong credentials, no
   * membership). Drives both the ARIA live-region politeness and the
   * banner's color. */
  tone: 'status' | 'alert';
}

export interface SignInFormProps {
  onSubmit: (credentials: SignInCredentials) => void;
  loading?: boolean;
  error?: SignInFormError | null;
}

interface SignInFormValues {
  identifier: string;
  password: string;
}

export function SignInForm({ onSubmit, loading = false, error = null }: SignInFormProps) {
  const { t } = useTranslation('auth');
  const regionConfig = useRegionConfig();
  const [showPassword, setShowPassword] = React.useState(false);

  // Rebuilt whenever the region changes (a locale switch mid-session) so
  // the identifier check always validates against the *current* phone
  // shape, not whatever region was active when the form first mounted.
  const schema = React.useMemo(
    () =>
      z.object({
        identifier: z
          .string()
          .trim()
          .min(1, t('identifier.required'))
          .refine(
            (value) => detectLoginIdentifier(value, regionConfig).kind !== 'invalid',
            t('identifier.invalid'),
          ),
        password: z.string().min(1, t('password.required')),
      }),
    [regionConfig, t],
  );

  const form = useForm<SignInFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: '', password: '' },
    mode: 'onBlur',
    reValidateMode: 'onBlur',
  });

  function handleValidSubmit(values: SignInFormValues): void {
    const identifier = detectLoginIdentifier(values.identifier, regionConfig);
    // Unreachable once the schema's own refine has passed — narrows the
    // union for the compiler rather than adding a real branch.
    if (identifier.kind === 'invalid') return;

    onSubmit(
      identifier.kind === 'email'
        ? { email: identifier.email, password: values.password }
        : { phone: identifier.phone, password: values.password },
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={(event) => void form.handleSubmit(handleValidSubmit)(event)}
        noValidate
        className="flex flex-col gap-4"
      >
        <div className="text-center">
          <p className="mb-6 text-sm font-semibold">{t('brand')}</p>
          <h1 className="text-xl font-semibold">{t('heading')}</h1>
          <p className="mb-5 text-sm text-muted-foreground">{t('subtext')}</p>
        </div>

        {error && (
          <div
            role={error.tone === 'alert' ? 'alert' : 'status'}
            className={cn(
              'rounded-lg p-3 text-sm',
              error.tone === 'alert'
                ? 'border border-destructive/50 bg-destructive/5 text-destructive'
                : 'bg-status-due-bg text-status-due-fg',
            )}
          >
            {error.message}
          </div>
        )}

        <FormField
          control={form.control}
          name="identifier"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="sign-in-identifier">{t('identifier.label')}</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  id="sign-in-identifier"
                  autoComplete="username"
                  placeholder={t('identifier.placeholder')}
                  disabled={loading}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel htmlFor="sign-in-password">{t('password.label')}</FormLabel>
              {/* The relative-positioning wrapper stays outside FormControl:
                  FormControl's Slot merges id/aria-describedby/aria-invalid
                  onto its one immediate child, so that child must be Input
                  itself — wrapping Input and the toggle Button together
                  inside FormControl would put those attributes on this div
                  instead of the actual input. */}
              <div className="relative">
                <FormControl>
                  <Input
                    {...field}
                    id="sign-in-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    disabled={loading}
                    className="pe-20"
                  />
                </FormControl>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={loading}
                  aria-pressed={showPassword}
                  aria-controls="sign-in-password"
                  className="absolute end-1 top-1/2 -translate-y-1/2"
                  onClick={() => setShowPassword((current) => !current)}
                >
                  {showPassword ? t('password.hide') : t('password.show')}
                </Button>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" loading={loading} className="w-full">
          {loading ? t('submit.loading') : t('submit.action')}
        </Button>
      </form>
    </Form>
  );
}
