import { useNavigate } from '@tanstack/react-router';

/**
 * `useNavigate()`'s `search` updater is typed against the app's
 * *registered* route tree (`declare module '@tanstack/react-router' {
 * interface Register { router: typeof router } }`, set once per app in
 * its own `main.tsx` — see that file's own comment). This package has no
 * such registration: `useListUrlState`, `useDetailShellTab` and
 * `useWizardShellStep` all have to work against whatever route tree the
 * *consuming* app declares, not a specific one `ui/` could register
 * itself. TypeScript can't verify a search shape it doesn't know exists
 * yet, so the cast below — narrowed to exactly this one call, routed
 * through `unknown` since asserting straight to the router's inferred
 * type is rejected as "these types don't sufficiently overlap" — is the
 * one deliberate escape hatch all three hooks share, rather than each
 * repeating it. The runtime behaviour is unaffected: it's exactly
 * `setSearchParams`-shaped regardless of what TypeScript can prove here.
 */
export function useSearchNavigate(): (
  updateSearch: (prev: Record<string, unknown>) => Record<string, unknown>,
) => void {
  const navigate = useNavigate();
  return (updateSearch) => {
    void navigate({ search: updateSearch } as unknown as Parameters<typeof navigate>[0]);
  };
}
