import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

/**
 * `/fees` — placeholder, same reasoning `/` (`index.tsx`): the real
 * fee-management module (fee structures, generation) is a later
 * feature-module ticket, not [8.9.1]'s. `/fees/dues` ([8.10.4]) is the
 * first real leaf under `_staff/fees` — this moved here (from
 * `_staff/fees.tsx`) once that leaf needed `_staff/fees.tsx` to become a
 * plain `<Outlet />` layout instead, so `/fees/dues` isn't swallowed by
 * this placeholder's own component.
 */
export const Route = createFileRoute('/_staff/fees/')({
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
