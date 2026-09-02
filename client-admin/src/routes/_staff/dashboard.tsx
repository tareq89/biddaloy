import { EmptyState, RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../route-loaders';

/**
 * `/` — a placeholder until a real dashboard module exists (not this
 * ticket's job). Exists mainly so the route tree has more than one leaf
 * to demonstrate [8.9.1]'s ACs against: it's lazy-loaded like every other
 * feature route, and its sidebar link is hover-preloadable like every
 * other.
 */
export const Route = createFileRoute('/_staff/dashboard')({
  // [8.14.5]: no query to preload — this route's only cost is its own
  // `nav` strings (already warm from `_staff.tsx`'s own loader, but
  // listed again here per the plan's per-route table so this route is
  // self-sufficient if ever moved out from under that layout).
  loader: () => loadRouteNamespaces('nav'),
  pendingComponent: DashboardPending,
  component: DashboardPage,
});

function DashboardPage() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();

  return (
    <EmptyState
      title={t('dashboard.title')}
      explanation={t('dashboard.explanation')}
      action={{ label: t('dashboard.action'), onClick: () => void navigate({ to: '/settings' }) }}
    />
  );
}

function DashboardPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
