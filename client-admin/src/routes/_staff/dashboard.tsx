import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

/**
 * `/` — a placeholder until a real dashboard module exists (not this
 * ticket's job). Exists mainly so the route tree has more than one leaf
 * to demonstrate [8.9.1]'s ACs against: it's lazy-loaded like every other
 * feature route, and its sidebar link is hover-preloadable like every
 * other.
 */
export const Route = createFileRoute('/_staff/dashboard')({
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
