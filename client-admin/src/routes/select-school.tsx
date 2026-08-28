import type { UserRole } from '@biddaloy/shared';
import { decodeAccessTokenMemberships, getAccessToken } from '@biddaloy/ui/api';
import { LocaleSwitcher, SchoolPicker } from '@biddaloy/ui/components';
import { logout, switchActiveTenant, useDensity } from '@biddaloy/ui/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

/**
 * [8.9.5]'s picker — reached chrome-free, like `/login`, whenever
 * `__root.tsx`'s guard finds an authenticated visitor with no active
 * tenant chosen yet (2+ memberships right after login, or a reload whose
 * persisted tenant didn't restore). Every membership (with names) is
 * already sitting in the access token — see `JwtMembership.name` — so
 * this reads it straight off `decodeAccessTokenMemberships`, no request.
 *
 * Same `redirect` search-param passthrough and same-app-only validation
 * as `login.tsx` (`isSameAppRedirect`) — duplicated rather than shared,
 * matching this repo's existing per-route-schema convention (see
 * `students/index.tsx`'s own `validateSearch`).
 */
const REDIRECT_PROBE_ORIGIN = 'http://redirect-probe.invalid';

function isSameAppRedirect(value: string): boolean {
  if (!value.startsWith('/')) return false;
  try {
    return new URL(value, REDIRECT_PROBE_ORIGIN).origin === REDIRECT_PROBE_ORIGIN;
  } catch {
    return false;
  }
}

const selectSchoolSearchSchema = z.object({
  redirect: z.string().refine(isSameAppRedirect).optional().catch(undefined),
});

export const Route = createFileRoute('/select-school')({
  validateSearch: selectSchoolSearchSchema,
  component: SelectSchoolPage,
});

function SelectSchoolPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const token = getAccessToken();
  const memberships = token ? decodeAccessTokenMemberships(token) : [];

  // [8.13.8] Comfortable density (contract section 6). Auth screens sit with
  // `/portal` rather than with the staff routes because they are
  // PRE-authentication: at this point nobody knows whether the visitor is a
  // guardian on a 360 px phone or an administrator on a desktop, so the
  // accessible 44 px target is the safe default for the unknown user.
  //
  // Called ABOVE the `memberships.length < 2` early return — a hook cannot
  // sit behind a conditional — and set on `document.documentElement` rather
  // than on the wrapper below, so the portalled `LocaleSwitcher` menu
  // inherits it too. See `useDensity`.
  useDensity('comfortable');

  // Both branches below are real, reachable edge cases — not just
  // defensive filler — but neither is the common path: `login()`/
  // `session.ts`'s cold-boot restore already auto-pick a lone membership,
  // and `__root.tsx`'s guard only sends a visitor here at all when the
  // active tenant came up unresolved. This still has to handle them
  // itself because the access token (this route's only source of truth)
  // can legitimately show 0 or 1 memberships by the time it's read —
  // e.g. a user removed from every school since their token was issued.
  React.useEffect(() => {
    if (memberships.length === 0) {
      // A memberless account has nowhere useful to go — revoke the
      // session server-side too, the same reasoning `login()`'s own
      // zero-memberships branch documents.
      void logout(queryClient).finally(() => void navigate({ to: '/login' }));
    } else if (memberships.length === 1) {
      const [only] = memberships;
      if (only) {
        switchActiveTenant(queryClient, only.tenantId, only.role);
        void navigate({ to: search.redirect ?? '/' });
      }
    }
    // Intentionally runs once on mount only — `memberships`/`search` are
    // derived from module-scoped state read at render time, not reactive
    // props this effect should re-run against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSelect(tenantId: string, role: UserRole): void {
    switchActiveTenant(queryClient, tenantId, role);
    void navigate({ to: search.redirect ?? '/' });
  }

  if (memberships.length < 2) return null; // the effect above is already navigating away

  return (
    <div className="flex min-h-screen flex-col bg-muted/20">
      <div className="flex justify-end p-4">
        <LocaleSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="w-full max-w-md">
          <SchoolPicker schools={memberships} onSelect={handleSelect} />
        </div>
      </div>
    </div>
  );
}
