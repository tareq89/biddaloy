/**
 * `/notifications` — [8.14.11]'s full-height view of the bell's history.
 * That history is stored per user + school in the browser (D4) and
 * `NotificationList` renders it a step at a time as the user scrolls.
 *
 * No `RequireRole`/`RequirePermission` of its own: `_staff.tsx` already
 * gates the whole layout on `STAFF_ROLES`, and this content is the
 * signed-in user's own history, not tenant data that needs a
 * finer-grained check.
 *
 * Not built on `ListShell` — that shell wraps a `DataTable`, and this is a
 * feed, not a table. An empty history gets the kit `EmptyState` here
 * instead of `NotificationList`'s own bare paragraph.
 */
import { markAllNotificationsRead, markNotificationRead } from '@biddaloy/ui/api';
import { Card, EmptyState, NotificationList, RoutePending } from '@biddaloy/ui/components';
import { useNotifications, useUnreadNotificationCount } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { Bell, CheckCheck } from 'lucide-react';

import { loadRouteNamespaces } from '../../route-loaders';

export const Route = createFileRoute('/_staff/notifications')({
  loader: () => loadRouteNamespaces('nav'),
  pendingComponent: NotificationsPending,
  component: NotificationsPage,
});

function NotificationsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label')} />;
}

function NotificationsPage() {
  const { t } = useTranslation('nav');
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();

  const description = t('notifications.pageDescription');
  const subtitle =
    unreadCount > 0
      ? [description, t('notifications.unreadCount', { count: unreadCount })].join(' · ')
      : description;

  return (
    <PageContainer size="narrow">
      <PageHeader
        title={t('notifications.pageTitle')}
        subtitle={subtitle}
        actions={[
          {
            id: 'mark-all-read',
            label: t('notifications.markAllRead'),
            priority: 'primary',
            icon: <CheckCheck />,
            // Hidden, not disabled, when there is nothing unread.
            allowed: unreadCount > 0,
            onClick: () => markAllNotificationsRead(),
          },
        ]}
      />
      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell />}
          title={t('notifications.emptyTitle')}
          explanation={t('notifications.emptyDescription')}
        />
      ) : (
        <Card className="p-2">
          <NotificationList
            notifications={notifications}
            onMarkRead={markNotificationRead}
            emptyLabel={t('notifications.empty')}
          />
        </Card>
      )}
    </PageContainer>
  );
}
