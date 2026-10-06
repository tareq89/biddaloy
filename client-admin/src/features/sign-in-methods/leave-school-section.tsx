import { ApiError } from '@biddaloy/ui/api';
import { Button, Card, ConfirmDialog, toast } from '@biddaloy/ui/components';
import { logout, useLeaveSchool, useSchoolProfile } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

/**
 * Staff-only "Leave this school" (`/security`, bottom). A guardian or student
 * never gets this section: their `/portal/account` page does not mount it.
 *
 * After a successful leave the token's membership list is stale, so the
 * session is ended and the person signs in again; with several schools
 * `/login` sends them on to `/select-school`.
 */
export function LeaveSchoolSection() {
  const { t } = useTranslation('signInMethods');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const profile = useSchoolProfile();
  const leave = useLeaveSchool();
  const [open, setOpen] = React.useState(false);
  const [lastAdmin, setLastAdmin] = React.useState(false);
  const school = profile.data?.name ?? t('leave.thisSchool');

  function handleOpenChange(next: boolean): void {
    setOpen(next);
    if (!next) {
      setLastAdmin(false);
      leave.reset();
    }
  }

  function handleConfirm(): void {
    leave.mutate(undefined, {
      onSuccess: () => {
        toast.success(t('leave.done', { school }));
        void logout(queryClient).then(() => navigate({ to: '/login' }));
      },
      onError: (error) => {
        if (error instanceof ApiError && error.details?.code === 'LAST_ADMIN') {
          setLastAdmin(true);
        } else {
          toast.error(t('leave.error'));
        }
      },
    });
  }

  return (
    <Card asChild padded>
      <section aria-labelledby="leave-school-title">
        <h2 id="leave-school-title" className="text-h2">
          {t('leave.title')}
        </h2>
        <p className="mt-1 text-text-secondary">{t('leave.section')}</p>
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full md:w-auto"
          onClick={() => setOpen(true)}
        >
          {t('leave.title')}
        </Button>
        <ConfirmDialog
          open={open}
          onOpenChange={handleOpenChange}
          title={t('leave.title')}
          description={lastAdmin ? t('leave.lastAdmin') : t('leave.body', { school })}
          confirmLabel={t('leave.confirm')}
          busy={leave.isPending}
          onConfirm={handleConfirm}
        />
      </section>
    </Card>
  );
}
