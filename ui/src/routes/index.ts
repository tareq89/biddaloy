/**
 * Router-dependent building blocks — `@tanstack/react-router`-specific,
 * unlike `ui/src/hooks/`'s otherwise router-agnostic hooks.
 *
 * [8.4.5] built these against `react-router`, a small, scoped choice for
 * its own integration-test harness at a time no app-wide router existed
 * yet. [8.9.1] adopted TanStack Router app-wide and ported this module
 * (and `use-detail-shell-tab.ts`/`use-wizard-shell-step.ts` in
 * `ui/src/shells/`, which build on `useListUrlState`) onto it — see
 * `ui/README.md`'s Routing section for the current API and why.
 */
export { RequireRole, type RequireRoleProps } from './require-role';
export { RequirePermission, type RequirePermissionProps } from './require-permission';
export { useListUrlState, type ListUrlState, type ListUrlStatePatch } from './use-list-url-state';
export { useSearchNavigate } from './navigate-search';
