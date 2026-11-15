import { ApiError } from '@biddaloy/ui/api';
import { AccessDeniedState, ErrorState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { z } from 'zod';

import { DashboardPage, DashboardSkeleton } from '../../dashboard/layout/dashboard-page';
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
function DashboardError({ error }: { error: unknown }) {
  const { t } = useTranslation('dashboard');
  const router = useRouter();
  // A suspended or trial-ended school has its own screen: the router's default error component.
  if ((error as { details?: { code?: string } } | null)?.details?.code === 'TENANT_SUSPENDED')
    throw error;
  if (error instanceof ApiError && error.statusCode === 403) return <AccessDeniedState />;
  return (
    <ErrorState
      message={t('states.error')}
      retryLabel={t('states.retry')}
      onRetry={() => void router.invalidate()}
    />
  );
}
