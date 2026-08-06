/**
 * Router-dependent building blocks — `react-router`-specific, unlike
 * `ui/src/hooks/`'s otherwise router-agnostic hooks.
 *
 * This is a deliberately minimal slice, scoped to [8.4.5]'s integration
 * test harness, not a full app-wide router adoption — that's [8.9.1]'s
 * job (see `ui/README.md`'s Testing section). `react-router` was picked
 * here as a small, focused choice for this harness; [8.9.1] makes its own
 * routing-library decision for the actual app shells, which may or may
 * not end up being this same package.
 */
export { RequireRole, type RequireRoleProps } from './require-role';
export { useListUrlState, type ListUrlState, type ListUrlStatePatch } from './use-list-url-state';
