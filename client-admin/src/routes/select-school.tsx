import type { UserRole } from '@biddaloy/shared';
import { decodeAccessTokenMemberships, getAccessToken, postAuthLogout } from '@biddaloy/ui/api';
import {
  AuthLayout,
  Button,
  EmptyState,
  SchoolInvitesCard,
  SchoolPicker,
} from '@biddaloy/ui/components';
import {
  switchActiveTenant,
  useSchoolInvites,
  useSchoolInvitesCardProps,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { isSafeSupportUrl } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { useSignOutToLogin } from '../features/demo/use-sign-out-to-login';
import { runtimeConfig } from '../runtime-config';
import { isSameAppRedirect } from '../same-app-redirect';

/**
 * [8.9.5]'s picker — reached chrome-free, like `/login`, whenever
 * `__root.tsx`'s guard finds an authenticated visitor with no active
 * tenant chosen yet (2+ memberships right after login, or a reload whose
 * persisted tenant didn't restore). Every membership (with names) is
 * already sitting in the access token — see `JwtMembership.name` — so
 * this reads it straight off `decodeAccessTokenMemberships`, no request.
 *
 * Same `redirect` search-param passthrough and same-app-only validation
 * (`isSameAppRedirect`) as `login.tsx`.
 */
const selectSchoolSearchSchema = z.object({
  redirect: z.string().refine(isSameAppRedirect).optional().catch(undefined),
});

export const Route = createFileRoute('/select-school')({
  validateSearch: selectSchoolSearchSchema,
  component: SelectSchoolPage,
});

function SelectSchoolPage() {
  const { t } = useTranslation('auth');
  const search = Route.useSearch();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const signOutToLogin = useSignOutToLogin();
  const invites = useSchoolInvitesCardProps();
  const { isPending: invitesPending, data: pendingInvites } = useSchoolInvites();
  // Unsettled counts as "may have invites": the refresh cookie must outlive the list so Accept can refresh.
  const hasInvitesOrUnknown = invitesPending || (pendingInvites?.length ?? 0) > 0;

  const token = getAccessToken();
  const memberships = token ? decodeAccessTokenMemberships(token) : [];

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
      // Pending invites keep the session alive (Accept needs the refresh cookie). With none,
      // the empty state stays up but the cookie is revoked now: on a shared office PC people
      // close the tab rather than press "Sign out".
      if (!hasInvitesOrUnknown) void postAuthLogout('/auth/logout').catch(() => {});
    } else if (memberships.length === 1) {
      const [only] = memberships;
      if (only) {
        switchActiveTenant(queryClient, only.tenantId, only.role);
        void navigate({ to: search.redirect ?? '/' });
      }
    }
    // `memberships`/`search` are derived from module-scoped state read at render
    // time, not reactive props; only the invite list settling (or an accepted
    // invite changing the token's memberships) should re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasInvitesOrUnknown, memberships.length]);

  function handleSelect(tenantId: string, role: UserRole): void {
    switchActiveTenant(queryClient, tenantId, role);
    void navigate({ to: search.redirect ?? '/' });
  }

  function handleSignOut(): void {
    void signOutToLogin();
  }

  if (memberships.length === 0) {
    const supportUrl = runtimeConfig().supportUrl;
    return (
      <AuthLayout>
        <SchoolInvitesCard {...invites.cardProps} />
        <EmptyState
          headingLevel={1}
          title={t('selectSchool.none.title')}
          explanation={t('selectSchool.none.body')}
          action={{ label: t('selectSchool.none.signOut'), onClick: handleSignOut }}
        />
        {isSafeSupportUrl(supportUrl) && (
          <Button asChild variant="ghost" className="mt-2 w-full text-primary">
            <a href={supportUrl}>{t('selectSchool.none.contact')}</a>
          </Button>
        )}
      </AuthLayout>
    );
  }

  if (memberships.length < 2) return null; // the effect above is already navigating away

  return (
    <AuthLayout>
      <SchoolInvitesCard {...invites.cardProps} />
      <SchoolPicker schools={memberships} onSelect={handleSelect} />
      <Button variant="ghost" className="mt-2 w-full text-primary" onClick={handleSignOut}>
        {t('schoolPicker.signOut')}
      </Button>
    </AuthLayout>
  );
}
