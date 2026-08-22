import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

/**
 * `/portal` — a placeholder, replaced by Epic 5.0's portal landing (#20),
 * which is blocked on the family-facing read API (#19). It exists now so a
 * guardian has a real destination instead of the staff dashboard's 403
 * dead end; it deliberately shows no data, because there is no endpoint a
 * PARENT is allowed to call for it yet.
 */
export const Route = createFileRoute('/portal/')({
  component: PortalOverviewPage,
});

function PortalOverviewPage() {
  const { t } = useTranslation('nav');
  const navigate = useNavigate();

  return (
    <EmptyState
      title={t('portal.overview.title')}
      explanation={t('portal.overview.explanation')}
      action={{
        label: t('portal.overview.action'),
        onClick: () => void navigate({ to: '/portal/fees' }),
      }}
    />
  );
}
