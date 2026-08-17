import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * The protected-route guard (`__root.tsx`'s `beforeLoad`) redirects every
 * unauthenticated visit here, with `?redirect=` set to the page they were
 * actually trying to reach — validated same-app below so a future login
 * form can navigate back to it safely.
 *
 * Deliberately a stub for now: no form, just a heading, so the guard has
 * a real route to send people to instead of a 404. Still renders inside
 * `RootLayout`'s `AppShell` (sidebar included) — an unauthenticated
 * visitor seeing nav links to pages they can't reach yet is accepted,
 * deferred polish, not a chrome-free auth layout yet.
 */
/** A fixed, non-routable base for probing where `value` resolves to — not
 * `window.location.origin`, so this stays a pure function testable without
 * a browser. `value.startsWith('/')` alone isn't enough: browsers resolve
 * a leading `\` the same as `/` (WHATWG URL spec), so `/\evil.com` and
 * `//evil.com` both resolve off-origin despite starting with a single
 * `/` — checking the *resolved* origin against the probe catches both. */
const REDIRECT_PROBE_ORIGIN = 'http://redirect-probe.invalid';

function isSameAppRedirect(value: string): boolean {
  if (!value.startsWith('/')) return false;
  try {
    return new URL(value, REDIRECT_PROBE_ORIGIN).origin === REDIRECT_PROBE_ORIGIN;
  } catch {
    return false;
  }
}

const loginSearchSchema = z.object({
  // Same-app relative path only — anything that resolves off-origin
  // (`//evil.com`, `/\evil.com`, and the equivalent percent-encoded form
  // `/%5Cevil.com`, which the router decodes before this schema ever sees
  // it) falls back to `undefined` via `.catch()`, the same defensive shape
  // `students/index.tsx`'s schema already uses.
  redirect: z.string().refine(isSameAppRedirect).optional().catch(undefined),
});

export const Route = createFileRoute('/login')({
  validateSearch: loginSearchSchema,
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation('nav');

  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-lg font-semibold">{t('login.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('login.explanation')}</p>
      </div>
    </div>
  );
}
