import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

/**
 * `/portal/fees` — a placeholder, replaced by Epic 5.0's fee breakdown and
 * invoice history (#21). Same reasoning as `portal/index.tsx`: the route
 * exists so the guardian shell has more than one destination and its nav
 * is real, but there is no guardian-scoped fees endpoint to render yet.
 */
export const Route = createFileRoute('/portal/fees')({
  component: PortalFeesPage,
});

function PortalFeesPage() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();

  return (
    <EmptyState
      title={t('portal.fees.title')}
      explanation={t('portal.fees.explanation')}
      action={{
        label: t('portal.fees.action'),
        onClick: () => void navigate({ to: '/portal' }),
      }}
    />
  );
}
