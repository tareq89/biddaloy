/**
 * [67.5.09] `/reports/alerts` — the monthly alerts report. Gated by
 * `route-permissions.ts` (`ALERT_REPORT_READ`).
 */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { AlertsReportView } from '../../../features/attention/report/alerts-report-view';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/reports/alerts')({
  loader: () => loadRouteNamespaces('attention', 'nav'),
  pendingComponent: AlertsReportPending,
  component: AlertsReportView,
});

function AlertsReportPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label')} />;
}
