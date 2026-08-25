/**
 * [8.11.8] — one staff member's page: Profile · Permissions (read-only
 * from `ROLE_PERMISSIONS`) · Memberships · Login History, mirroring
 * `guardians/$guardianId.tsx`'s `DetailShell`/`useDetailShellTab` shape.
 *
 * The Login History tab is mounted only behind
 * `useHasPermission(Permission.AUDIT_LOG_READ)` — `GET /audit-logs` is
 * ADMIN-only server-side, so the UI and the server agree instead of
 * showing a tab that can only 403.
 *
 * "Remove from school" deletes only this school's membership row. When
 * the viewed user *is* the logged-in user the dialog renders the action
 * disabled with an explanation — self-removal is prevented client-side
 * and again by the server's own 400.
 */
import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import { useCurrentUserId, useHasPermission, useTeachers, useUser } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { LoginHistoryTab } from './-detail/login-history-tab';
import { MembershipsTab } from './-detail/memberships-tab';
import { PermissionsTab } from './-detail/permissions-tab';
import { ProfileTab } from './-detail/profile-tab';
import { EditTeacherDialog } from './-edit-teacher-dialog';
import { EditUserDialog } from './-edit-user-dialog';
import { RemoveMemberDialog } from './-remove-member-dialog';

const staffDetailSearchSchema = z.object({
  // Invalid values fall back to the first tab inside `useDetailShellTab`,
  // same as `guardians/$guardianId.tsx`.
  tab: z.string().optional(),
});

export const Route = createFileRoute('/_staff/staff/$userId')({
  validateSearch: staffDetailSearchSchema,
  component: StaffDetailPage,
});

function StaffDetailPage() {
  const { userId } = Route.useParams();
  const { t } = useTranslation('staff');
  const navigate = useNavigate();
  const userQuery = useUser(userId);
  const teacherQuery = useTeachers({ user_id: userId, limit: 1 });
  const teacher = teacherQuery.data?.data[0];

  const canUpdate = useHasPermission(Permission.USER_UPDATE);
  const canRemove = useHasPermission(Permission.MEMBER_REMOVE);
  const canReadAuditLogs = useHasPermission(Permission.AUDIT_LOG_READ);
  const currentUserId = useCurrentUserId();

  const tabIds = canReadAuditLogs
    ? (['profile', 'permissions', 'memberships', 'loginHistory'] as const)
    : (['profile', 'permissions', 'memberships'] as const);
  const [activeTab, setActiveTab] = useDetailShellTab(tabIds);

  const [editUserOpen, setEditUserOpen] = React.useState(false);
  const [editTeacherOpen, setEditTeacherOpen] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);

  const regionConfig = useTenantRegionConfig();

  const tabs = [
    {
      id: 'profile',
      label: t('detail.tabs.profile'),
      content: <ProfileTab userId={userId} />,
    },
    {
      id: 'permissions',
      label: t('detail.tabs.permissions'),
      content: <PermissionsTab userId={userId} />,
    },
    {
      id: 'memberships',
      label: t('detail.tabs.memberships'),
      content: <MembershipsTab userId={userId} />,
    },
    ...(canReadAuditLogs
      ? [
          {
            id: 'loginHistory',
            label: t('detail.tabs.loginHistory'),
            content: <LoginHistoryTab userId={userId} />,
          },
        ]
      : []),
  ];

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        <Link
          to="/staff"
          className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
        >
          {t('detail.back')}
        </Link>

        {userQuery.isPending ? (
          <Skeleton className="h-7 w-64" />
        ) : userQuery.isError ? (
          <ErrorState
            message={
              userQuery.error instanceof ApiError && userQuery.error.statusCode === 403
                ? t('detail.forbidden')
                : t('detail.loadError')
            }
            retryLabel={t('actions.retry', { ns: 'common' })}
            onRetry={() => void userQuery.refetch()}
          />
        ) : (
          <>
            <DetailShell
              name={userQuery.data.full_name}
              identifiers={
                userQuery.data.role !== null
                  ? t(`roles.${userQuery.data.role}`)
                  : (userQuery.data.email ?? '')
              }
              statusBadge={<StatusBadge domain="user" status={userQuery.data.status} />}
              actions={[
                {
                  id: 'editUser',
                  label: t('detail.actions.editUser'),
                  allowed: canUpdate,
                  onClick: () => setEditUserOpen(true),
                },
                ...(teacher !== undefined
                  ? [
                      {
                        id: 'editTeacher',
                        label: t('detail.actions.editTeacher'),
                        allowed: canUpdate,
                        onClick: () => setEditTeacherOpen(true),
                      },
                    ]
                  : []),
                {
                  id: 'remove',
                  label: t('detail.actions.remove'),
                  allowed: canRemove,
                  onClick: () => setRemoveOpen(true),
                },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              tabs={tabs}
            />

            <EditUserDialog
              open={editUserOpen}
              onOpenChange={setEditUserOpen}
              user={userQuery.data}
            />
            {teacher !== undefined && (
              <EditTeacherDialog
                open={editTeacherOpen}
                onOpenChange={setEditTeacherOpen}
                teacher={teacher}
              />
            )}
            <RemoveMemberDialog
              open={removeOpen}
              onOpenChange={setRemoveOpen}
              user={userQuery.data}
              isSelf={userQuery.data.id === currentUserId}
              onRemoved={() => void navigate({ to: '/staff' })}
            />
          </>
        )}
      </div>
    </RegionConfigProvider>
  );
}
