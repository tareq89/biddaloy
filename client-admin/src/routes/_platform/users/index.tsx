import { UserRole } from '@biddaloy/shared';
import { Input, Label } from '@biddaloy/ui/components';
import {
  PLATFORM_USER_SEARCH_MIN,
  useDebouncedValue,
  usePlatformUserSearch,
  type PlatformUserItem,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { LoginAsDialog } from '../../../features/cockpit/login-as/login-as-dialog';
import { loadRouteNamespaces } from '../../../route-loaders';

import { ForceLogoutDialog } from './-force-logout-dialog';
import { UserResults, type UserMembership } from './-user-results';

/**
 * The owner's Users page (mockup "Users"): one box for a phone or email, every school and role
 * that person has, Login as per school and Sign out everywhere per person.
 */
export const Route = createFileRoute('/_platform/users/')({
  // `loginAs`: the dialog and the role names.
  loader: () => loadRouteNamespaces('platformUsers', 'loginAs'),
  component: UsersPage,
});

const DEBOUNCE_MS = 300;

function UsersPage() {
  const { t } = useTranslation('platformUsers');
  const navigate = useNavigate();
  const [q, setQ] = React.useState('');
  const debounced = useDebouncedValue(q, DEBOUNCE_MS);
  const search = usePlatformUserSearch(debounced);
  const [loginAsFor, setLoginAsFor] = React.useState<{
    user: PlatformUserItem;
    membership: UserMembership;
  } | null>(null);
  const [logoutFor, setLogoutFor] = React.useState<PlatformUserItem | null>(null);

  const searched = debounced.trim().length >= PLATFORM_USER_SEARCH_MIN;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-h1">{t('title')}</h1>
        <p className="mt-0.5 text-text-secondary">{t('caption')}</p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="platform-user-search">{t('searchLabel')}</Label>
        <Input
          id="platform-user-search"
          type="search"
          autoComplete="off"
          value={q}
          placeholder={t('searchPlaceholder')}
          onChange={(event) => setQ(event.target.value)}
        />
      </div>

      {searched ? (
        <UserResults
          users={search.data ?? []}
          loading={search.isLoading}
          error={search.isError}
          onRetry={() => void search.refetch()}
          onLoginAs={(user, membership) => setLoginAsFor({ user, membership })}
          onLogout={setLogoutFor}
        />
      ) : (
        <p className="text-text-secondary">{t('hint', { count: PLATFORM_USER_SEARCH_MIN })}</p>
      )}

      {loginAsFor && (
        <LoginAsDialog
          open
          onOpenChange={(open) => !open && setLoginAsFor(null)}
          schoolId={loginAsFor.membership.schoolId}
          schoolName={loginAsFor.membership.schoolName}
          defaultRole={loginAsFor.membership.role as UserRole}
          onInviteAdmin={() => {
            const id = loginAsFor.membership.schoolId;
            setLoginAsFor(null);
            void navigate({ to: '/schools/$schoolId', params: { schoolId: id } });
          }}
        />
      )}

      {logoutFor && (
        <ForceLogoutDialog
          open
          onOpenChange={(open) => !open && setLogoutFor(null)}
          person={logoutFor}
        />
      )}
    </div>
  );
}
