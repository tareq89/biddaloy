/**
 * `/notifications` — "Alerts & notifications" (67.2.05). A To-do tab (default)
 * and a History tab, both rendered by the shared `AttentionWorklist`. The tab
 * and the filters live in the URL.
 *
 * No `RequireRole`/`RequirePermission` of its own: `_staff.tsx` already gates
 * the whole layout on `STAFF_ROLES`, and the list is the signed-in user's own.
 */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { AttentionWorklist } from '../../features/attention/attention-worklist';
import { loadRouteNamespaces } from '../../route-loaders';

const searchSchema = z.object({
  tab: z.enum(['active', 'history']).optional().catch(undefined),
  // Landing flag from the palette: the shell opens the to-do modal on it (67.2.04).
  alerts: z.literal(1).optional().catch(undefined),
  category: z.string().optional().catch(undefined),
  class_id: z.string().optional().catch(undefined),
  section_id: z.string().optional().catch(undefined),
  page: z.number().int().positive().optional().catch(undefined),
  limit: z.number().int().positive().optional().catch(undefined),
  selected: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/notifications')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('nav', 'attention'),
  pendingComponent: NotificationsPending,
  component: NotificationsPage,
});

function NotificationsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label')} />;
}

function NotificationsPage() {
  const { tab = 'active' } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AttentionWorklist
      scope="staff"
      tab={tab}
      // Filters belong to a tab: drop them when switching.
      onTabChange={(next) => void navigate({ search: { tab: next } })}
    />
  );
}
