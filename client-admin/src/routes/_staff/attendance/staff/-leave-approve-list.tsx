/**
 * [36.4] No list endpoint for pending leave requests exists yet
 * (`GET /leave/requests`, B18) — nothing to decide on. Replace this with a
 * real list, using `useDecideLeaveRequest`, once that endpoint ships.
 */
import { EmptyState } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Inbox } from 'lucide-react';

export function LeaveApproveList() {
  const { t } = useTranslation('leave');
  return (
    <EmptyState
      icon={<Inbox />}
      title={t('approve.title')}
      explanation={t('approve.notAvailableMessage')}
    />
  );
}
