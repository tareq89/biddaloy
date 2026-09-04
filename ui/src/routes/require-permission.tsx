import type { Permission } from '@biddaloy/shared';
import type { ReactNode } from 'react';

import { AccessDeniedState } from '../components/access-denied-state';
import { useHasPermission } from '../hooks/permissions';

export interface RequirePermissionProps {
  /** The permission the active role needs to see `children`. Reactive,
   * like `useHasPermission` itself — a mid-session role switch (a
   * `TenantBar` change) re-evaluates this on its own. */
  permission: Permission;
  /** Where "take me somewhere I can go" goes, wired to
   * `AccessDeniedState`'s own `onAction`. Optional — omit it and no
   * escape button renders at all. */
  onDenied?: () => void;
  /** Passed straight through to `AccessDeniedState`'s own overrides — one
   * escape hatch, not three separate ones, for the one route
   * (`/audit-logs`) whose refusal copy is more specific than the generic
   * default. Every other caller leaves these unset and gets
   * `common:accessDenied`'s copy, which is the whole point of one shared
   * pattern. */
  title?: string;
  explanation?: string;
  actionLabel?: string;
  children: ReactNode;
}

/**
 * [8.14.17]'s permission gate, siblings with `RequireRole` but different
 * on the one point that matters: `RequireRole` answers "is this the right
 * *app half*" (staff vs. portal) and redirects, because a guardian on a
 * staff URL is simply lost. `RequirePermission` answers "does this role
 * hold the right *permission* within the app half it's already in", and
 * **renders in place** instead — silently bouncing a teacher who typed
 * `/fees/dues` somewhere unexplained is its own bug, not a fix for the
 * one `RequireRole` solves.
 *
 * No `useEffect`, no `navigate` call anywhere in this file — that's the
 * contract, not an implementation detail, and
 * `ui/src/routes/require-permission.test.tsx` spies on `navigate` to keep
 * it that way. A refused visit stays on its own URL and renders
 * `AccessDeniedState`; only `onDenied`, fired by the user clicking the
 * component's own button, ever calls `navigate`.
 *
 * Router-agnostic, like `RequireRole`'s `redirectTo` is not: this
 * component itself never imports `@tanstack/react-router`. The caller
 * supplies `onDenied`, exactly the same shape `AccessDeniedState.onAction`
 * takes.
 */
export function RequirePermission({
  permission,
  onDenied,
  title,
  explanation,
  actionLabel,
  children,
}: RequirePermissionProps) {
  const allowed = useHasPermission(permission);
  if (!allowed) {
    // `AccessDeniedState`'s props are `exactOptionalPropertyTypes` — an
    // omitted override must stay omitted, not become an explicit
    // `undefined`, so this can't spread `{ title, explanation, actionLabel,
    // onAction: onDenied }` directly.
    return (
      <AccessDeniedState
        {...(title !== undefined && { title })}
        {...(explanation !== undefined && { explanation })}
        {...(actionLabel !== undefined && { actionLabel })}
        {...(onDenied !== undefined && { onAction: onDenied })}
      />
    );
  }
  return children;
}
