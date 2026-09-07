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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../route-loaders';

export const Route = createFileRoute('/_staff/security')({
  loader: () => loadRouteNamespaces('auth'),
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
  const config = useRegionConfig();
  const { locale } = useLocale();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const sessionsQuery = useQuery(sessionsQueryOptions());
  const revokeSession = useRevokeSession();

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

  if (sessionsQuery.isError) {
    return (
      <ErrorState
        message={t('sessions.error')}
        retryLabel={t('sessions.retry')}
        onRetry={() => void sessionsQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{t('sessions.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('sessions.description')}</p>
      </div>
      <SessionList
        sessions={sessionsQuery.data ?? []}
        loading={sessionsQuery.isPending}
        onRevoke={(id) => {
          const target = sessionsQuery.data?.find((session) => session.id === id);
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
    </div>
  );
}
