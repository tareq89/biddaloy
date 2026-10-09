/**
 * `/portal/notifications` — the guardian/student worklist (67.2.06). Same
 * shared `AttentionWorklist` as the staff page; `scope="portal"` swaps the
 * class/section filters for a child filter. Not in the portal nav: reached
 * from the bell and the alerts modal.
 */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AttentionWorklist } from '../../features/attention/attention-worklist';
import { loadRouteNamespaces } from '../../route-loaders';

const searchSchema = z.object({
  tab: z.enum(['active', 'history']).optional().catch(undefined),
  category: z.string().optional().catch(undefined),
  student_id: z.string().optional().catch(undefined),
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  selected: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/notifications')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('portal', 'attention'),
  pendingComponent: PortalNotificationsPending,
  component: PortalNotificationsPage,
});

function PortalNotificationsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label')} />;
}

function PortalNotificationsPage() {
  const { tab = 'active' } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AttentionWorklist
      scope="portal"
      tab={tab}
      onTabChange={(next) => void navigate({ search: { tab: next } })}
    />
  );
}
