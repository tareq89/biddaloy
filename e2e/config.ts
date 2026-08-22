// One entry per shell `playwright.config.ts` boots via `webServer`. Page
// objects and fixtures ([8.5.2], [8.5.3]) key off this list instead of
// hardcoding ports, so a new shell only has to be added here.
//
// One shell since [8.9.10]: staff and guardians share a single SPA served
// at `/`, split by route (`_staff` layout vs `/portal`) rather than by
// package. The five-file stub this list used to name as its own shell is
// gone.
export const shells = {
  // Every route is auth-guarded (__root.tsx's beforeLoad) — an
  // unauthenticated visit always redirects to /login, which is what this
  // proves boots correctly. Real per-shell coverage (incl. an
  // authenticated path, and the role-aware `/` redirect) is [8.5.3]'s job.
  // Heading text is Bangla ("Sign in") — DEFAULT_LOCALE is 'bn'
  // (ui/src/i18n/locale-storage.ts) and a fresh browser context has no
  // persisted locale, so this is what renders first regardless of test
  // environment locale.
  app: { baseURL: 'http://localhost:5174/', heading: 'লগ ইন' },
} as const;
