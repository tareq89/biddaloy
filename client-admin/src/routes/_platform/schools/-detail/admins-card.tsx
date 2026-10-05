/**
 * #535's admins card: the school's ADMIN memberships (`GET
 * /schools/:id/admins`, #531) as a quiet kit table with icon row actions
 * (resend / revoke). Adding an admin is the header's primary action and the
 * empty state's button — both open `AddAdminDialog`, owned by the route.
 */
import {
  Card,
  DataTable,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import type { SchoolAdminListItem } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatPhone } from '@biddaloy/ui/utils';

import { useAdminRowActions } from './admin-row';

export interface AdminsCardProps {
  schoolId: string;
  admins?: SchoolAdminListItem[];
  loading: boolean;
  error?: string;
  onRetry?: () => void;
  onAdd: () => void;
}

export function AdminsCard({ schoolId, admins, loading, error, onRetry, onAdd }: AdminsCardProps) {
  const { t } = useTranslation('platform');
  const config = useRegionConfig();
  const { actionsFor, dialog } = useAdminRowActions(schoolId);

  const columns: DataTableColumn<SchoolAdminListItem>[] = [
    {
      id: 'name',
      header: t('schoolDetail.admins.nameColumn'),
      accessorFn: (row) => <span className="font-medium">{row.name}</span>,
      card: 'title',
    },
    {
      id: 'contact',
      header: t('schoolDetail.admins.contactColumn'),
      accessorFn: (row) => row.email ?? (row.phone ? formatPhone(row.phone, config) : '—'),
      card: 'subtitle',
    },
    {
      id: 'invitation',
      header: t('schoolDetail.admins.invitationColumn'),
      accessorFn: (row) =>
        row.invitation ? <StatusBadge domain="invitation" status={row.invitation.status} /> : '—',
      card: 'badge',
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="p-4 md:px-5">
        <h2 className="text-h2">{t('schoolDetail.admins.title')}</h2>
        <p className="mt-1 text-text-secondary">{t('schoolDetail.admins.help')}</p>
      </div>

      {loading ? (
        <Skeleton className="mx-4 mb-4 h-24 w-[calc(100%-2rem)]" />
      ) : error || !admins ? (
        <div className="p-4 pt-0 md:px-5">
          <ErrorState
            message={error ?? t('schoolDetail.admins.loadError')}
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={onRetry ?? (() => {})}
          />
        </div>
      ) : (
        <DataTable
          tableId="platform-school-admins"
          caption={t('schoolDetail.admins.tableCaption')}
          columns={columns}
          data={admins}
          getRowId={(row) => row.user_id}
          sorting={null}
          onSortingChange={() => undefined}
          paginated={false}
          totalCount={admins.length}
          rowActions={actionsFor}
          emptyState={{
            title: t('schoolDetail.admins.empty'),
            explanation: t('schoolDetail.admins.emptyExplanation'),
            action: { label: t('schoolDetail.admins.addAction'), onClick: onAdd },
          }}
        />
      )}
      {dialog}
    </Card>
  );
}
