// One entry per shell `playwright.config.ts` boots via `webServer`. Page
// objects and fixtures ([8.5.2], [8.5.3]) key off this list instead of
// hardcoding ports, so a new shell only has to be added here.
export const shells = {
  student: { baseURL: 'http://localhost:5173/student/', heading: 'biddaloy Student' },
  // Admin's routes are auth-guarded (__root.tsx's beforeLoad) — an
  // unauthenticated visit always redirects to /login, which is what this
  // proves boots correctly. "Admin" itself never renders as a heading;
  // real per-shell coverage (incl. an authenticated path) is [8.5.3]'s job.
  // Heading text is Bangla ("Sign in") — DEFAULT_LOCALE is 'bn'
  // (ui/src/i18n/locale-storage.ts) and a fresh browser context has no
  // persisted locale, so this is what renders first regardless of test
  // environment locale.
  admin: { baseURL: 'http://localhost:5174/admin/', heading: 'লগ ইন' },
} as const;
