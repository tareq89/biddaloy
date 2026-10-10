/**
 * [67.5.09] `/communications/send-alert` — the full-page "Send an alert" form.
 * Gated by `route-permissions.ts` (`ALERT_SEND`); the component checks nothing itself.
 */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { SendAlertForm } from '../../../features/attention/send-alert/send-alert-form';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/communications/send-alert')({
  loader: () => loadRouteNamespaces('attention', 'nav'),
  pendingComponent: SendAlertPending,
  component: SendAlertPage,
});

function SendAlertPage() {
  const navigate = useNavigate();
  const close = useCloseFullPage(() => void navigate({ to: '/communications/send' }));
  return <SendAlertForm onClose={close} />;
}

function SendAlertPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label')} />;
}
