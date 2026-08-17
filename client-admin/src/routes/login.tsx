import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

/**
 * [8.9.3]'s protected-route guard (`__root.tsx`'s `beforeLoad`) redirects
 * every unauthenticated visit here, with `?redirect=` set to the page they
 * were actually trying to reach. [8.9.4] reads that search param once the
 * real login form exists and navigates back to it after a successful
 * login — the schema below already validates it so that ticket doesn't
 * have to redo search-param validation.
 *
 * This route is deliberately a stub until then: no form, just a heading,
 * so `beforeLoad` has a real, matching route to send people to instead of
 * a 404 — a text-only placeholder explicitly marked "replaced by a later
 * ticket" like this one skips this repo's design-mockup-first convention
 * for UI work (`ui/CONTRIBUTING.md`'s "Design before you build").
 *
 * Still renders inside `RootLayout`'s `AppShell` (sidebar included) — an
 * unauthenticated visitor seeing nav links to pages they can't reach yet
 * is accepted, deferred polish, not this ticket's job; [8.9.4]/[8.9.5] own
 * giving auth routes their own chrome-free layout.
 */
const loginSearchSchema = z.object({
  // Same-app relative path only — `//evil.com` (protocol-relative) fails
  // the negative lookahead and falls back to `undefined` via `.catch()`,
  // the same defensive shape `students/index.tsx`'s schema already uses.
  redirect: z
    .string()
    .regex(/^\/(?!\/)/)
    .optional()
    .catch(undefined),
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
