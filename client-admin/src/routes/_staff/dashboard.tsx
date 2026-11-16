import { ApiError, isTenantSuspendedError } from '@biddaloy/ui/api';
import { AccessDeniedState, ErrorState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { z } from 'zod';

import { DashboardPage, DashboardSkeleton } from '../../dashboard/layout/dashboard-page';
import { RouteErrorFallbackWithUpdate } from '../../route-error-fallback';
import { loadRouteNamespaces } from '../../route-loaders';

/** `?customize=1` opens customise mode (2-11). */
const searchSchema = z.object({ customize: z.literal(1).optional().catch(undefined) });

/**
 * `/dashboard` — the role's widget grid ([169] Epic, wave 2). Widgets are
 * files under `src/dashboard/widgets/` picked up by the registry.
 */
export const Route = createFileRoute('/_staff/dashboard')({
  validateSearch: searchSchema,
  loader: () =>
    loadRouteNamespaces(
      'dashboard',
      'calendar',
      'nav',
      'attention',
      'auth',
      'setupChecklist',
      'attendance',
      'applications',
      'printHistory',
      'setupChecklist',
      'reports',
      'reportView',
    ),
  pendingComponent: DashboardPending,
  errorComponent: DashboardError,
  component: DashboardRoute,
});

function DashboardRoute() {
  const { customize } = Route.useSearch();
  return <DashboardPage customize={customize === 1} />;
}

function DashboardPending() {
  const { t } = useTranslation('nav');
  return (
    <>
      <span className="sr-only">{t('routePending.label')}</span>
      <DashboardSkeleton />
    </>
  );
}

/** A failed load says so with a retry; a refusal (403) says that instead. */
function DashboardError(props: ErrorComponentProps) {
  const { error } = props;
  const { t: tDashboard } = useTranslation('dashboard');
  const router = useRouter();
  // A suspended or trial-ended school has its own screen: the router's default error component.
  // Render it here; rethrowing left the route stuck on its pending skeleton.
  if (isTenantSuspendedError(error)) return <RouteErrorFallbackWithUpdate {...props} />;
  if (error instanceof ApiError && error.statusCode === 403) return <AccessDeniedState />;
  return (
    <ErrorState
      message={tDashboard('states.error')}
      retryLabel={tDashboard('states.retry')}
      onRetry={() => void router.invalidate()}
    />
  );
}
