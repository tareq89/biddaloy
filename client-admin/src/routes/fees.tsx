import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

/**
 * `/fees` — a placeholder, same reasoning as `/` (`index.tsx`): the real
 * fee-management module is a later feature-module ticket, not [8.9.1]'s.
 * Exists so the route tree has a fourth lazy-loaded leaf to check
 * "route-level code splitting" against in the bundle report.
 */
export const Route = createFileRoute('/fees')({
  component: FeesPage,
});

function FeesPage() {
  const { t } = useTranslation('fees');
  const navigate = useNavigate();

  return (
    <EmptyState
      title={t('title')}
      explanation={t('explanation')}
      action={{ label: t('action'), onClick: () => void navigate({ to: '/settings' }) }}
    />
  );
}
