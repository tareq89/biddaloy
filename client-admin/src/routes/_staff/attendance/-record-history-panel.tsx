/**
 * [9.7] One attendance record's own correction/audit trail —
 * `GET /attendance/records/:recordId/history`. Rendered inside the
 * correction dialog's "History" disclosure, and reachable straight from a
 * row's overflow menu (a read-only viewer without `ATTENDANCE_CORRECT`
 * can still open just this panel, without the edit form around it).
 *
 * The query is scoped to exactly one `recordId` end to end
 * (`recordHistoryQueryOptions` in `ui/src/hooks/attendance.ts`) — this
 * component never widens it to the section or the tenant, per the plan's
 * own "never widen query" constraint.
 *
 * `performed_by_name` is `null` here: `getRecordHistory` calls
 * `findByEntity`, which (per `AuditLogResponseDto`'s own comment) never
 * joins the `performed_by` relation the way the tenant-wide audit log
 * screen's `findAll` does. Rendering the raw `performed_by_user_id` is a
 * deliberate, documented gap here, not a bug — resolving it into a name
 * is a server change and therefore out of scope for this client-only
 * ticket.
 */

import {
  EmptyState,
  ErrorState,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@biddaloy/ui/components';
import { useRecordHistory, type RecordHistoryEntry } from '@biddaloy/ui/hooks';
import { useLocale, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatRelativeAge } from '@biddaloy/ui/utils';
import { History } from 'lucide-react';

export interface RecordHistoryPanelProps {
  recordId: string | undefined;
  studentName: string;
}

function statusLabel(t: (key: string) => string, status: unknown): string {
  if (typeof status !== 'string' || status === '') return '—';
  return t(`statusControl.status.${status}`);
}

function HistoryRow({ entry }: { entry: RecordHistoryEntry }) {
  const { t } = useTranslation('attendance');
  const { locale } = useLocale();
  const regionConfig = useTenantRegionConfig();

  const from = statusLabel(t, entry.old_values?.['status']);
  const to = statusLabel(t, entry.new_values?.['status']);
  const reason =
    typeof entry.new_values?.['reason'] === 'string' ? entry.new_values['reason'] : null;
  const createdAt = new Date(entry.created_at);
  const actor = entry.performed_by_name
    ? t('history.entryActor', { actor: entry.performed_by_name })
    : entry.performed_by_user_id
      ? t('history.entryActorUnknownName', { actorId: entry.performed_by_user_id })
      : null;

  return (
    <li className="flex flex-col gap-1 border-b border-border-subtle py-3 last:border-b-0">
      <p className="text-sm font-medium">{t('history.entryChange', { from, to })}</p>
      {actor && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <p className="w-fit text-xs text-muted-foreground">
                {actor} · {formatRelativeAge(createdAt.getTime(), locale)}
              </p>
            </TooltipTrigger>
            <TooltipContent>{formatDateTime(createdAt, regionConfig)}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {reason && <p className="text-sm text-muted-foreground italic">&ldquo;{reason}&rdquo;</p>}
    </li>
  );
}

export function RecordHistoryPanel({ recordId, studentName }: RecordHistoryPanelProps) {
  const { t } = useTranslation('attendance');
  const query = useRecordHistory(recordId);

  if (query.isPending) {
    return (
      <div aria-label={t('history.loadingLabel')} className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        message={t('history.errorMessage')}
        onRetry={() => void query.refetch()}
        retryLabel={t('history.retry')}
        icon={<History aria-hidden="true" />}
      />
    );
  }

  const rows = query.data?.data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('history.emptyTitle')}
        explanation={t('history.emptyExplanation')}
        action={{ label: t('history.retry'), onClick: () => void query.refetch() }}
        icon={<History aria-hidden="true" />}
      />
    );
  }

  return (
    <ul aria-label={t('history.title', { name: studentName })} className="flex flex-col">
      {rows.map((entry) => (
        <HistoryRow key={entry.id} entry={entry} />
      ))}
    </ul>
  );
}
