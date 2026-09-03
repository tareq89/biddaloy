/**
 * `/notifications` — [8.14.11]'s full-height view of the same in-session
 * history the bell's popover shows, for when an 80px-tall panel isn't
 * enough.
 *
 * No `RequireRole`/`RequirePermission` of its own: `_staff.tsx` already
 * gates the whole layout on `STAFF_ROLES`, and this content is the
 * signed-in user's own session history, not tenant data that needs a
 * finer-grained check.
 *
 * Not built on `ListShell` — that shell wraps a `DataTable`
 * (`ui/src/shells/list-shell.tsx`), and this is a feed, not a table.
 * `NotificationList` already renders its own empty-state paragraph when
 * there's nothing to show, so this route doesn't layer a second
 * `EmptyState` on top of it.
 */
import { markAllNotificationsRead, markNotificationRead } from '@biddaloy/ui/api';
import { Button, NotificationList, RoutePending } from '@biddaloy/ui/components';
import { useNotifications, useUnreadNotificationCount } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">{t('notifications.pageTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('notifications.pageDescription')}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={unreadCount === 0}
          onClick={() => markAllNotificationsRead()}
        >
          {t('notifications.markAllRead')}
        </Button>
      </div>
      <NotificationList
        notifications={notifications}
        onMarkRead={markNotificationRead}
        emptyLabel={t('notifications.empty')}
      />
    </div>
  );
}
