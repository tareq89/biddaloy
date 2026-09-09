/**
 * [12.8] Presentational session/device list for the Security surfaces
 * (`/security` staff route, `/portal/account`'s Devices card). Card-per-
 * session — not a table, matching `portal/account.tsx`'s own card
 * grammar and working at portal widths, unlike `login-history-tab.tsx`'s
 * table (which is a staff-only, wider-viewport surface).
 *
 * No data fetching here — the caller (`security.tsx`, `account.tsx`)
 * owns `sessionsQueryOptions()`/`useRevokeSession()` and passes the
 * results in, same split every other list component in this package
 * documents.
 */
import * as React from 'react';

import { useTranslation, type RegionConfig } from '../i18n';
import { describeUserAgent, formatDateTime, formatRelativeAge } from '../utils';

import { Button } from './button';
import { Card } from './card';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';

export interface Session {
  id: string;
  started_at: string;
  last_used_at: string;
  user_agent: string | null;
  ip_address: string | null;
  current: boolean;
}

export interface SessionListProps {
  sessions: Session[];
  onRevoke: (id: string) => void;
  onRevokeAll: () => void;
  revokingId?: string | null;
  revokingAll?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Region config, for `formatDateTime`'s tenant-time-zone title attribute. */
  config: RegionConfig;
  locale: string;
}

export function SessionList({
  sessions,
  onRevoke,
  onRevokeAll,
  revokingId = null,
  revokingAll = false,
  loading = false,
  error = null,
  onRetry,
  config,
  locale,
}: SessionListProps) {
  const { t } = useTranslation('auth');
  const [confirmingAll, setConfirmingAll] = React.useState(false);

  if (loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t('sessions.title')}</span>
        <Skeleton className="h-20 w-full rounded-lg" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-border-subtle bg-card p-4">
        <p className="text-sm text-muted-foreground">{error}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t('sessions.retry')}
          </Button>
        )}
      </div>
    );
  }

  // Only the caller's own device is signed in (or the list came back
  // empty, which should not happen in practice but is handled the same
  // way) — nothing to revoke, so the whole revoke UI is replaced with an
  // explanatory empty state rather than a single, action-less card.
  const onlyCurrentDevice = sessions.length <= 1;

  if (onlyCurrentDevice) {
    return (
      <EmptyState
        kind="empty"
        title={t('sessions.title')}
        explanation={t('sessions.empty')}
        action={{ label: t('sessions.retry'), onClick: () => onRetry?.() }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            onRevoke={() => onRevoke(session.id)}
            revoking={revokingId === session.id}
            config={config}
            locale={locale}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="destructive"
        className="self-start"
        loading={revokingAll}
        onClick={() => setConfirmingAll(true)}
      >
        {t('sessions.signOutAll')}
      </Button>

      <Dialog open={confirmingAll} onOpenChange={setConfirmingAll}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('sessions.confirmAllTitle')}</DialogTitle>
            <DialogDescription>{t('sessions.confirmAllBody')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('sessions.cancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmingAll(false);
                onRevokeAll();
              }}
            >
              {t('sessions.signOutAll')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SessionCard({
  session,
  onRevoke,
  revoking,
  config,
  locale,
}: {
  session: Session;
  onRevoke: () => void;
  revoking: boolean;
  config: RegionConfig;
  locale: string;
}) {
  const { t } = useTranslation('auth');
  const device = describeUserAgent(session.user_agent);
  const deviceLabel = device ? `${device.browser} · ${device.os}` : t('sessions.unknownDevice');

  const lastUsedDate = new Date(session.last_used_at);
  const startedDate = new Date(session.started_at);

  return (
    <Card
      className="flex flex-col gap-2 p-4"
      data-testid="session-row"
      data-current={session.current}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{deviceLabel}</span>
            {session.current && (
              <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                {t('sessions.thisDevice')}
              </span>
            )}
          </div>
          <span
            className="text-xs text-muted-foreground"
            title={formatDateTime(startedDate, config)}
          >
            {t('sessions.startedAt', {
              relative: formatRelativeAge(startedDate.getTime(), locale),
            })}
          </span>
          <span
            className="text-xs text-muted-foreground"
            title={formatDateTime(lastUsedDate, config)}
          >
            {t('sessions.lastUsed', {
              relative: formatRelativeAge(lastUsedDate.getTime(), locale),
            })}
          </span>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={revoking}
          onClick={onRevoke}
          aria-label={t('sessions.signOutDevice', { device: deviceLabel })}
        >
          {t('sessions.signOut')}
        </Button>
      </div>
    </Card>
  );
}
