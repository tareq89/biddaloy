import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { StaffImportView } from '../../../features/staff-import/staff-import-view';
import { loadRouteNamespaces } from '../../../route-loaders';

/** [13.6.1] `/staff/import` — the staff Excel import. The welcome wizard links
 * here with `?from=welcome` to get a "Back to setup" link. Permission:
 * `route-permissions.ts` (the same one "Add user" uses). */
export const Route = createFileRoute('/_staff/staff/import')({
  validateSearch: z.object({ from: z.literal('welcome').optional().catch(undefined) }),
  loader: () => loadRouteNamespaces('staffImport', 'staff', 'bulkImport'),
  pendingComponent: StaffImportPending,
  component: StaffImportView,
});

function StaffImportPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label')} />;
}
