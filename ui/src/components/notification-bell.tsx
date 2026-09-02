/**
 * [8.9.8]'s notification centre — the bell keeps history of async outcomes
 * (a bulk import finishing, a reminder batch completing, an SMS delivery
 * failing) for anything a user missed while on another screen. Toasts
 * (`./toast.tsx`) already give immediate, polite-announced feedback; this
 * is the separate, longer-lived list, backed by `../api/notification-
 * state.ts` and its `useSyncExternalStore` hooks (`../hooks/
 * notifications.ts`).
 *
 * Built on `./popover.tsx`, not `./menu.tsx` — see that wrapper's own
 * comment for why a plain popover (ordinary Tab order) fits a
 * read/unread list better than `Menu`'s roving-tabindex command-list ARIA
 * pattern. Radix's own focus-trap-on-open/focus-return-on-close covers
 * keyboard operability, same as `Dialog` (`dialog.test.tsx` already
 * exercises that behaviour end to end for the primitive family).
 */
import { BellIcon } from 'lucide-react';

import {
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationRecord,
} from '../api/notification-state';
import { useNotifications, useUnreadNotificationCount } from '../hooks/notifications';

import { Button } from './button';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from './popover';

export interface NotificationBellProps {
  /** Accessible name for the trigger button, before the unread count is
   * appended — a caller passes a translated string. `ui`'s own components
   * don't call the translation hook themselves (see `ui/CONTRIBUTING.md`'s
   * i18n rules), so this stays a plain English default like `AppShell`'s
   * own `openMenuLabel`. */
  label?: string;
  /** Visible panel title. */
  panelTitle?: string;
  /** Shown when there are no notifications yet. */
  emptyLabel?: string;
  /** Label for the "mark all read" action. */
  markAllReadLabel?: string;
}

function NotificationRow({ notification }: { notification: NotificationRecord }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => markNotificationRead(notification.id)}
        disabled={notification.read}
        className="flex w-full flex-col gap-0.5 rounded-md p-2 text-start text-sm hover:bg-accent disabled:hover:bg-transparent"
      >
        <span className="flex items-center gap-2">
          {!notification.read && (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-primary" />
          )}
          <span className={notification.read ? 'text-muted-foreground' : undefined}>
            {notification.message}
          </span>
        </span>
        <time dateTime={notification.createdAt} className="text-xs text-muted-foreground">
          {new Date(notification.createdAt).toLocaleString()}
        </time>
      </button>
    </li>
  );
}

export function NotificationBell({
  label = 'Notifications',
  panelTitle = 'Notifications',
  emptyLabel = "You're all caught up.",
  markAllReadLabel = 'Mark all read',
}: NotificationBellProps) {
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          iconOnly
          aria-label={unreadCount > 0 ? `${label}, ${unreadCount} unread` : label}
          className="relative"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="text-destructive-foreground absolute end-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={panelTitle} className="w-80">
        <PopoverHeader className="flex-row items-center justify-between">
          <PopoverTitle>{panelTitle}</PopoverTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={() => markAllNotificationsRead()}
          >
            {markAllReadLabel}
          </Button>
        </PopoverHeader>
        {notifications.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {notifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
