/**
 * [8.14.11] The presentational half of the notification centre. Split
 * from `notification-bell.tsx` for exactly the reason `sync-status.tsx`
 * splits its own presentational rows out (see that file's header
 * comment): this component takes its data as props so it can be driven
 * directly from a story or a test, without seeding module-scoped state
 * and hoping the store is clean.
 *
 * Variant is carried by an **icon plus a word**, never by colour alone —
 * the icon sits in a tinted chip whose `bg-status-*-bg` / `text-status-
 * *-fg` pairing is one `ui/scripts/check-contrast.mjs` already verifies
 * in both themes, and a visually-hidden label spells the variant out for
 * anyone who cannot tell the tints apart.
 *
 * Timestamps go through `formatRelativeAge` (`../utils/date`) rather than
 * `toLocaleString`, which makes Bengali numerals fall out for free — same
 * reasoning `sync-status.tsx:361` gives.
 */
import { AlertTriangle, CheckCircle2, CircleDashed } from 'lucide-react';
import * as React from 'react';

import type { NotificationRecord, NotificationVariant } from '../api/notification-state';
import { useLocale, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatRelativeAge } from '../utils/date';

const VARIANT_STYLES: Record<
  NotificationVariant,
  { fg: string; bg: string; icon: React.ComponentType<{ className?: string }> }
> = {
  // Mirrors `status-badge.tsx:36-47`'s tone vocabulary by hand rather than
  // importing it: `TONE_STYLES` is that component's private internal, and
  // exporting it to share three rows would make it public API.
  success: { fg: 'text-status-paid-fg', bg: 'bg-status-paid-bg', icon: CheckCircle2 },
  error: { fg: 'text-status-overdue-fg', bg: 'bg-status-overdue-bg', icon: AlertTriangle },
  info: { fg: 'text-status-partial-fg', bg: 'bg-status-partial-bg', icon: CircleDashed },
};

export interface NotificationListProps {
  notifications: readonly NotificationRecord[];
  /** Called with the record's id when its row is activated. */
  onMarkRead: (id: string) => void;
  /** Shown in place of the list when there's nothing yet. */
  emptyLabel: string;
  /** Caps scroll height — the bell's popover passes `max-h-80`, the
   * full-page view passes nothing. */
  className?: string;
  /** Rows rendered per step; more are added when the end of the list scrolls into view. */
  pageSize?: number;
}

function NotificationRow({
  notification,
  onMarkRead,
}: {
  notification: NotificationRecord;
  onMarkRead: (id: string) => void;
}) {
  const { t } = useTranslation('nav');
  const { locale } = useLocale();
  const style = VARIANT_STYLES[notification.variant];
  const Icon = style.icon;

  return (
    <li>
      <button
        type="button"
        onClick={() => onMarkRead(notification.id)}
        disabled={notification.read}
        className="flex w-full items-start gap-2 rounded-md p-2 text-start text-sm hover:bg-accent disabled:hover:bg-transparent"
      >
        <span
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
            style.bg,
            style.fg,
          )}
        >
          <Icon className="size-4" />
          <span className="sr-only">{t(`notifications.variant.${notification.variant}`)}</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-start gap-2">
            {!notification.read && (
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
            )}
            <span className={notification.read ? 'text-muted-foreground' : undefined}>
              {notification.message}
            </span>
          </span>
          <time dateTime={notification.createdAt} className="text-xs text-muted-foreground">
            {formatRelativeAge(Date.parse(notification.createdAt), locale)}
          </time>
        </span>
      </button>
    </li>
  );
}

export function NotificationList({
  notifications,
  onMarkRead,
  emptyLabel,
  className,
  pageSize = 20,
}: NotificationListProps) {
  const { t } = useTranslation('nav');
  const [visibleCount, setVisibleCount] = React.useState(pageSize);
  const sentinelRef = React.useRef<HTMLLIElement>(null);
  const total = notifications.length;
  // A shorter list (cleared, or swapped on a school switch) starts again at one page.
  const [prevTotal, setPrevTotal] = React.useState(total);
  if (total !== prevTotal) {
    setPrevTotal(total);
    if (total < prevTotal) setVisibleCount(pageSize);
  }
  const hasMore = visibleCount < total;

  React.useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver !== 'function') {
      setVisibleCount(total);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setVisibleCount((c) => c + pageSize);
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [visibleCount, total, pageSize]);

  if (total === 0) {
    return <p className="p-2 text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <ul className={cn('flex flex-col gap-1 overflow-y-auto', className)}>
      {notifications.slice(0, visibleCount).map((notification) => (
        <NotificationRow
          key={notification.id}
          notification={notification}
          onMarkRead={onMarkRead}
        />
      ))}
      {hasMore ? (
        <li data-list-sentinel ref={sentinelRef} className="p-2 text-caption text-muted-foreground">
          {t('notifications.loadingMore', { ns: 'common' })}
        </li>
      ) : (
        total > pageSize && (
          <li className="p-2 text-caption text-muted-foreground">
            {t('notifications.endOfList', { ns: 'common' })}
          </li>
        )
      )}
    </ul>
  );
}
