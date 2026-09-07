/**
 * #535's admins card: the school's ADMIN memberships (`GET
 * /schools/:id/admins`, #531) plus the inline "Add admin" form (`POST
 * /schools/:id/admins`). Wires its own mutations directly — same shape
 * `InvitationCard` (`staff/-detail/invitation-card.tsx`) uses — rather
 * than splitting a separate presentational component, since this card
 * has no Storybook-relevant "loading school" state beyond what
 * `admins`/`loading`/`error` already cover.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Card, ErrorState, Skeleton } from '@biddaloy/ui/components';
import {
  useAddSchoolAdmin,
  type AddSchoolAdminInput,
  type SchoolAdminListItem,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

import { AddAdminForm } from './add-admin-form';
import { AdminRow } from './admin-row';

export interface AdminsCardProps {
  schoolId: string;
  admins?: SchoolAdminListItem[];
  loading: boolean;
  error?: string;
  onRetry?: () => void;
}

export function AdminsCard({ schoolId, admins, loading, error, onRetry }: AdminsCardProps) {
  const { t } = useTranslation('platform');
  const addAdmin = useAddSchoolAdmin(schoolId);
  const [addError, setAddError] = React.useState<string | undefined>(undefined);

  function handleAdd(values: AddSchoolAdminInput) {
    setAddError(undefined);
    addAdmin.mutate(values, {
      onError: (mutationError: unknown) => {
        setAddError(
          mutationError instanceof ApiError
            ? mutationError.message
            : t('schoolDetail.admins.addError'),
        );
      },
    });
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold">{t('schoolDetail.admins.title')}</h2>

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : error || !admins ? (
        <ErrorState
          message={error ?? t('schoolDetail.admins.loadError')}
          retryLabel={t('actions.retry', { ns: 'common' })}
          onRetry={onRetry ?? (() => {})}
        />
      ) : admins.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('schoolDetail.admins.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {admins.map((admin) => (
            <AdminRow key={admin.user_id} schoolId={schoolId} admin={admin} />
          ))}
        </ul>
      )}

      <AddAdminForm
        submitting={addAdmin.isPending}
        {...(addError !== undefined ? { submitError: addError } : {})}
        onSubmit={handleAdd}
      />
    </Card>
  );
}
