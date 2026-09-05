/**
 * The living version of the "Biddaloy Client UI" design project's
 * `templates/sign-in` mockup — originally [8.9.4], restyled to the card /
 * brand-mark / icon-alert mockup approved after it (see
 * `ui/CONTRIBUTING.md`'s "Design before you build"). Presentational and
 * validation only, no network: `client-admin/src/routes/login.tsx` owns the
 * `useMutation` calling `ui/src/hooks/auth.ts`'s `login()` and the redirect
 * on success, so this component (and its Storybook states below) stays the
 * one sign-in surface the app shares, staff and guardian alike.
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
import type { ReactNode } from 'react';
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
  /** Consumer-owned destination — `ui/` cannot know the route tree, same
   * reasoning as `UserMenu.profileItem` (`user-menu.tsx`). Rendered under
   * the submit button, right-aligned; `client-admin/src/routes/login.tsx`
   * passes a `<Link to="/forgot-password">`. */
  secondaryAction?: ReactNode;
}

interface SignInFormValues {
  identifier: string;
  password: string;
}

/** Decorative, `aria-hidden` — the adjacent `<span>{error.message}</span>`
 * is the only thing a screen reader announces for the banner. */
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

export function SignInForm({
  onSubmit,
  loading = false,
  error = null,
  secondaryAction,
}: SignInFormProps) {
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
    <div className="flex flex-col gap-6">
      {/* Decorative logotype, not `t()`-translated: a brand mark keeps a
          fixed glyph the same way a logo image would, regardless of which
          locale's `t('brand')` wordmark sits next to it. */}
      <div className="flex items-center justify-center gap-2">
        <div
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand text-base font-bold text-primary-foreground"
        >
          ব
        </div>
        <span className="text-lg font-semibold tracking-tight">{t('brand')}</span>
      </div>

      <Form {...form}>
        <form
          onSubmit={(event) => void form.handleSubmit(handleValidSubmit)(event)}
          noValidate
          className="flex flex-col gap-6 rounded-lg border border-border-subtle bg-card p-8"
        >
          <div className="flex flex-col gap-1 text-center">
            <h1 className="text-xl font-semibold text-balance">{t('heading')}</h1>
            <p className="text-sm text-muted-foreground">{t('subtext')}</p>
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
                    {/* [8.13.8] This toggle is INSET inside the field, so it
                    is the one control that must not simply take
                    `--control-h`. `size="sm"` used to be 28 px inside a 32 px
                    input; once both sides read the same variable they became
                    44 px inside a 44 px field, and the ghost hover background
                    painted straight over the input's top/bottom borders and
                    rounded end corner.

                    So the height is derived from the field's rather than
                    equal to it: `--control-h` minus 4 px keeps exactly the
                    2 px-per-side inset it has always had (28 px compact,
                    40 px comfortable). The `::after` then gives back the
                    4 px the inset costs, using the same negative-inset
                    hit-area-extension pattern as `primitives/checkbox.tsx`
                    (`inset-x-0` so the pseudo-element has real width to
                    receive the clicks — an `inset-y`-only `::after` would be
                    zero-wide and catch nothing)
                    — which `e2e/responsive/target-size.spec.ts` measures — so
                    the tap target is the full 44 px even though the painted
                    button is not. See the density note in §6. */}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={loading}
                      aria-pressed={showPassword}
                      aria-controls="sign-in-password"
                      className="absolute end-1 top-1/2 h-[calc(var(--control-h,2rem)-0.25rem)] -translate-y-1/2 after:absolute after:inset-x-0 after:-inset-y-[0.125rem]"
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? t('password.hide') : t('password.show')}
                    </Button>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <Button type="submit" loading={loading} className="w-full">
            {loading ? t('submit.loading') : t('submit.action')}
          </Button>

          {secondaryAction && <div className="text-end text-sm">{secondaryAction}</div>}
        </form>
      </Form>
    </div>
  );
}
