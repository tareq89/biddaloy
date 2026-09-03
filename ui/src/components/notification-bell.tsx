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
 *
 * [8.14.11]: this component now resolves its own strings via
 * `useTranslation('nav')` instead of taking four label props, matching
 * `tenant-bar.tsx:65` and `sync-status.tsx:114`. The props are kept as
 * optional overrides so Storybook can pin copy.
 *
 * The badge count goes through `Intl.NumberFormat(locale)`, **not**
 * `useRegionConfig()`. This component renders in `_staff.tsx`'s app
 * chrome, outside every `RegionConfigProvider` in the app, so
 * `useRegionConfig()` would fall back to that context's default value
 * `REGION_BD_BN` and print Bengali digits to an English user. Locale is
 * the honest input here, same as `formatRelativeAge` already takes.
 */
import { Link } from '@tanstack/react-router';
import { BellIcon } from 'lucide-react';
import * as React from 'react';

import { markAllNotificationsRead, markNotificationRead } from '../api/notification-state';
import { useNotifications, useUnreadNotificationCount } from '../hooks/notifications';
import { useLocale, useTranslation } from '../i18n';

import { Button } from './button';
import { NotificationList } from './notification-list';
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from './popover';

export interface NotificationBellProps {
  /** Overrides the translated trigger label. */
  label?: string;
  /** Overrides the translated panel title. */
  panelTitle?: string;
  /** Overrides the translated empty-state copy. */
  emptyLabel?: string;
  /** Overrides the translated "mark all read" label. */
  markAllReadLabel?: string;
  /** When set, the panel grows a footer link to the full history page.
   * A plain route path, untyped against any consumer's generated route
   * tree, for the same reason `AppShellNavItem['to']` (`./app-shell.tsx`)
   * is. */
  viewAllTo?: string;
}

export function NotificationBell({
  label,
  panelTitle,
  emptyLabel,
  markAllReadLabel,
  viewAllTo,
}: NotificationBellProps) {
  const { t } = useTranslation('nav');
  const { locale } = useLocale();
  const notifications = useNotifications();
  const unreadCount = useUnreadNotificationCount();
  // Controlled only so the view-all link can close the panel on click, and
  // return focus to the trigger, the same as any other in-panel navigation
  // away from this popover.
  const [open, setOpen] = React.useState(false);

  const resolvedLabel = label ?? t('notifications.bellLabel');
  const resolvedPanelTitle = panelTitle ?? t('notifications.panelLabel');
  const resolvedEmptyLabel = emptyLabel ?? t('notifications.empty');
  const resolvedMarkAllReadLabel = markAllReadLabel ?? t('notifications.markAllRead');

  const badgeText =
    unreadCount > 9
      ? t('notifications.badgeOverflow', { count: 9 })
      : new Intl.NumberFormat(locale).format(unreadCount);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          iconOnly
          aria-label={
            unreadCount > 0
              ? t('notifications.bellLabelUnread', { count: unreadCount })
              : resolvedLabel
          }
          className="relative"
        >
          <BellIcon />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="text-destructive-foreground absolute end-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-medium"
            >
              {badgeText}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label={resolvedPanelTitle} className="w-80">
        <PopoverHeader className="flex-row items-center justify-between">
          <PopoverTitle>{resolvedPanelTitle}</PopoverTitle>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={unreadCount === 0}
            onClick={() => markAllNotificationsRead()}
          >
            {resolvedMarkAllReadLabel}
          </Button>
        </PopoverHeader>
        <NotificationList
          notifications={notifications}
          onMarkRead={markNotificationRead}
          emptyLabel={resolvedEmptyLabel}
          className="max-h-80"
        />
        {viewAllTo !== undefined && (
          <Link
            to={viewAllTo}
            onClick={() => setOpen(false)}
            className="mt-1 block rounded-md p-2 text-sm text-primary hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            {t('notifications.viewAll')}
          </Link>
        )}
      </PopoverContent>
    </Popover>
  );
}
