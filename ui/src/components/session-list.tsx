/**
 * [12.8] Presentational session/device list for the Security surfaces
 * (`/security` staff route, `/portal/account`'s Devices card). One divided
 * list — not a table, so it works at portal widths, unlike
 * `login-history-tab.tsx`'s table (staff-only, wider viewports).
 *
 * [31.2.14a] `variant="full"` (default) is the framed `/security` list;
 * `"compact"` is unframed, with one meta line and icon sign-out buttons, for
 * sitting inside the host's own card.
 *
 * No data fetching here — the caller (`security.tsx`, `account.tsx`)
 * owns `sessionsQueryOptions()`/`useRevokeSession()` and passes the
 * results in, same split every other list component in this package
 * documents.
 */
import { CircleHelpIcon, LogOutIcon, MonitorIcon, SmartphoneIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation, type RegionConfig } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { describeUserAgent, formatDateTime, formatRelativeAge } from '../utils';

import { Button } from './button';
import { ConfirmDialog } from './confirm-dialog';
import { EmptyState } from './empty-state';
import { Skeleton } from './skeleton';
import { StatusBadge } from './status-badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip';

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
  /** `full` (default): the framed `/security` list. `compact`: unframed, one
   * meta line and icon sign-out buttons, for inside a host card. */
  variant?: 'full' | 'compact';
}

function DeviceIcon({ userAgent, className }: { userAgent: string | null; className?: string }) {
  const os = describeUserAgent(userAgent)?.os;
  const Icon = !os
    ? CircleHelpIcon
    : os === 'iOS' || os === 'Android'
      ? SmartphoneIcon
      : MonitorIcon;
  return <Icon className={className} aria-hidden="true" />;
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
  variant = 'full',
}: SessionListProps) {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const [confirmingAll, setConfirmingAll] = React.useState(false);
  const compact = variant === 'compact';

  if (loading) {
    return (
      <div
        className={cn(
          'flex flex-col gap-2',
          !compact && 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1',
        )}
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">{t('sessions.title')}</span>
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-lg border border-border-subtle bg-surface p-4">
        <p className="text-text-secondary">{error}</p>
        {onRetry && (
          <Button type="button" variant="outline" onClick={onRetry}>
            {t('sessions.retry')}
          </Button>
        )}
      </div>
    );
  }

  // Only the caller's own device is signed in (or the list came back
  // empty, which should not happen in practice but is handled the same
  // way) — nothing to revoke, so the whole revoke UI is replaced with an
  // explanatory empty state.
  if (sessions.length <= 1) {
    return (
      <EmptyState kind="empty" title={t('sessions.title')} explanation={t('sessions.empty')} />
    );
  }

  const signOutAll = (
    <Button
      type="button"
      variant="outline"
      className="text-destructive"
      loading={revokingAll}
      onClick={() => setConfirmingAll(true)}
    >
      <LogOutIcon aria-hidden="true" />
      {t('sessions.signOutAll')}
    </Button>
  );

  const list = (
    <ul
      className={cn(
        'divide-y divide-border-subtle',
        compact && 'mt-3 border-t border-border-subtle',
      )}
    >
      {sessions.map((session) => (
        <SessionRow
          key={session.id}
          session={session}
          onRevoke={() => onRevoke(session.id)}
          revoking={revokingId === session.id}
          config={config}
          locale={locale}
          compact={compact}
        />
      ))}
    </ul>
  );

  return (
    <>
      {compact ? (
        <div>
          {list}
          <div className="mt-3 flex flex-col gap-2 border-t border-border-subtle pt-4 md:flex-row md:justify-end">
            {signOutAll}
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface shadow-e1">
          {list}
          <div className="flex flex-col gap-2 border-t border-border-subtle px-4 py-3 md:flex-row md:items-center md:justify-between md:px-5">
            <p className="text-text-secondary">
              {tc('sessionList.deviceCount', { count: sessions.length })}
            </p>
            {signOutAll}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmingAll}
        onOpenChange={setConfirmingAll}
        tone="danger"
        title={t('sessions.confirmAllTitle')}
        description={t('sessions.confirmAllBody')}
        confirmLabel={t('sessions.signOutAll')}
        cancelLabel={t('sessions.cancel')}
        onConfirm={() => {
          setConfirmingAll(false);
          onRevokeAll();
        }}
      />
    </>
  );
}

function SessionRow({
  session,
  onRevoke,
  revoking,
  config,
  locale,
  compact,
}: {
  session: Session;
  onRevoke: () => void;
  revoking: boolean;
  config: RegionConfig;
  locale: string;
  compact: boolean;
}) {
  const { t } = useTranslation('auth');
  const { t: tc } = useTranslation('common');
  const device = describeUserAgent(session.user_agent);
  const deviceLabel = device ? `${device.browser} · ${device.os}` : t('sessions.unknownDevice');
  const ip = session.ip_address ? tc('sessionList.ipAddress', { ip: session.ip_address }) : null;
  const ariaLabel = t('sessions.signOutDevice', {
    device: ip ? `${deviceLabel}, ${ip}` : deviceLabel,
  });

  const lastUsedDate = new Date(session.last_used_at);
  const startedDate = new Date(session.started_at);
  const lastUsed = t('sessions.lastUsed', {
    relative: formatRelativeAge(lastUsedDate.getTime(), locale),
  });

  const titleLine = (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium">{deviceLabel}</span>
      {session.current && <StatusBadge tone="success" label={t('sessions.thisDevice')} />}
    </div>
  );

  if (compact) {
    return (
      <li
        className="flex items-center gap-3 py-2"
        data-testid="session-row"
        data-current={session.current}
      >
        <DeviceIcon
          userAgent={session.user_agent}
          className="size-5 shrink-0 text-text-secondary"
        />
        <div className="min-w-0 flex-1">
          {titleLine}
          <p
            className="text-caption text-text-secondary"
            title={formatDateTime(lastUsedDate, config)}
          >
            {lastUsed}
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                iconOnly
                className="text-destructive"
                loading={revoking}
                onClick={onRevoke}
                aria-label={ariaLabel}
              >
                <LogOutIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('sessions.signOut')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </li>
    );
  }

  return (
    <li
      className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:px-5"
      data-testid="session-row"
      data-current={session.current}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-text-secondary">
          <DeviceIcon userAgent={session.user_agent} className="size-5" />
        </span>
        <div className="min-w-0">
          {titleLine}
          <p className="text-text-secondary" title={formatDateTime(lastUsedDate, config)}>
            {[ip, lastUsed].filter(Boolean).join(' · ')}
          </p>
          <p className="text-caption text-text-secondary">
            {tc('sessionList.signedInAt', { date: formatDateTime(startedDate, config) })}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="ms-12 self-start md:ms-0 md:self-auto"
        loading={revoking}
        onClick={onRevoke}
        aria-label={ariaLabel}
      >
        <LogOutIcon aria-hidden="true" />
        {t('sessions.signOut')}
      </Button>
    </li>
  );
}
