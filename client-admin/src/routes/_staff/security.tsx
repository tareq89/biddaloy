/**
 * [12.8] `/security` — the staff shell's counterpart to `/portal/account`'s
 * Devices card: a self-scoped list of the signed-in user's own active
 * sessions, reachable from `StaffUserMenu`'s new Security item. No
 * `RequirePermission` of its own beyond the route-permissions map's
 * `DASHBOARD_VIEW` (see `route-permissions.ts`'s own comment) — this is the
 * caller's own session history, not tenant data.
 */
import { ErrorState, RoutePending, SessionList, toast } from '@biddaloy/ui/components';
import { logoutAll, sessionsQueryOptions, useRevokeSession } from '@biddaloy/ui/hooks';
import {
  useRegionConfig,
  useLocale,
  useTranslation,
  RegionConfigProvider,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { CalendarFeedCard } from '../../components/calendar-feed-card';
import { loadRouteNamespaces } from '../../route-loaders';

export const Route = createFileRoute('/_staff/security')({
  // [17.4.3]: `calendarFeed` loaded alongside `auth` so the mounted
  // `CalendarFeedCard` never suspends into a blank namespace on first
  // visit — same rule `loadRouteNamespaces`'s own docstring documents.
  loader: () => loadRouteNamespaces('auth', 'calendarFeed', 'nav'),
  pendingComponent: SecurityPending,
  component: SecurityRoute,
});

function SecurityPending() {
  const { t } = useTranslation('auth');
  return <RoutePending variant="detail" label={t('sessions.title')} />;
}

function SecurityRoute() {
  return (
    <RegionConfigProvider>
      <SecurityPage />
    </RegionConfigProvider>
  );
}

function SecurityPage() {
  const { t } = useTranslation('auth');
  const { t: tNav } = useTranslation('nav');
  const { t: tCommon } = useTranslation('common');
  const config = useRegionConfig();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const sessionsQuery = useQuery(sessionsQueryOptions());
  const revokeSession = useRevokeSession();

  // The current device first (the user's anchor), then newest activity first.
  const sessions = React.useMemo(
    () =>
      [...(sessionsQuery.data ?? [])].sort(
        (a, b) =>
          Number(b.current) - Number(a.current) || b.last_used_at.localeCompare(a.last_used_at),
      ),
    [sessionsQuery.data],
  );

  async function handleRevokeAll(): Promise<void> {
    try {
      await logoutAll(queryClient);
    } catch {
      // `logoutAll()` already clears local auth state/cache in its own
      // `finally` even when the network call fails (offline, a transient
      // 5xx). Swallowed here rather than left to propagate: this handler
      // always navigates away regardless, and its caller discards the
      // promise, so an escaped rejection would only surface as an
      // unhandled-rejection error with nothing left to react to it.
    } finally {
      void navigate({ to: '/login' });
    }
  }

  return (
    <PageContainer size="narrow">
      <PageHeader title={tNav('items.security')} subtitle={tNav('security.pageDescription')} />
      {sessionsQuery.isError ? (
        <ErrorState
          message={t('sessions.error')}
          retryLabel={t('sessions.retry')}
          onRetry={() => void sessionsQuery.refetch()}
        />
      ) : (
        <section aria-labelledby="sessions-title" className="space-y-3">
          <div>
            <h2 id="sessions-title" className="text-h2">
              {t('sessions.title')}
            </h2>
            <p className="mt-1 text-text-secondary">{t('sessions.description')}</p>
          </div>
          {/* No global mutation error handler: a failed sign-out must say so.
              The next attempt resets the mutation, clearing this line. */}
          {revokeSession.isError && (
            <p role="alert" className="text-destructive">
              {tCommon('status.error')}
            </p>
          )}
          <SessionList
            sessions={sessions}
            loading={sessionsQuery.isPending}
            onRevoke={(id) => {
              const target = sessions.find((session) => session.id === id);
              const current = target?.current ?? false;
              revokeSession.mutate(
                { id, current },
                { onSuccess: () => !current && toast.success(t('sessions.revokedToast')) },
              );
            }}
            onRevokeAll={() => void handleRevokeAll()}
            revokingId={revokeSession.isPending ? (revokeSession.variables?.id ?? null) : null}
            onRetry={() => void sessionsQuery.refetch()}
            config={config}
            locale={locale}
          />
        </section>
      )}
      <CalendarFeedCard />
    </PageContainer>
  );
}
