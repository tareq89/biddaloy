/**
 * [99.G4.04] The last 90 days of Biddaloy support logins on this school (who, when, why, type,
 * how many changes) and the other platform actions on it. A live row has End, behind a confirm
 * dialog. Words follow `tenant-control-glossary.md`: the screen never says "session".
 */
import {
  Button,
  ConfirmDialog,
  DataTable,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import type { PlatformActionItem, SupportSessionItem } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';
import * as React from 'react';

/** `TEACHER` -> `Teacher`; the role comes from the server as a code. */
export function roleLabel(role: string): string {
  const lower = role.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export interface SupportAccessSessionsListProps {
  sessions: SupportSessionItem[] | undefined;
  platformActions: PlatformActionItem[] | undefined;
  loading: boolean;
  error: boolean;
  onEnd: (id: string) => void;
  /** The End request is in flight. */
  ending?: boolean;
  endFailed?: boolean;
}

const noSort = () => undefined;

export function SupportAccessSessionsList({
  sessions,
  platformActions,
  loading,
  error,
  onEnd,
  ending = false,
  endFailed = false,
}: SupportAccessSessionsListProps) {
  const { t } = useTranslation('supportAccess');
  const region = useRegionConfig();
  const [endTarget, setEndTarget] = React.useState<SupportSessionItem | null>(null);
  const when = (iso: string) => formatDateTime(new Date(iso), region);
  const errorText = error ? t('historyError') : undefined;

  const sessionColumns: DataTableColumn<SupportSessionItem>[] = [
    {
      id: 'who',
      header: t('colWho'),
      accessorFn: (r) => t('who', { person: r.personName, role: roleLabel(r.role) }),
    },
    { id: 'when', header: t('colWhen'), accessorFn: (r) => when(r.startedAt) },
    { id: 'reason', header: t('colReason'), accessorFn: (r) => r.reason },
    {
      id: 'kind',
      header: t('colKind'),
      accessorFn: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusBadge
            tone={r.kind === 'EMERGENCY' ? 'danger' : 'neutral'}
            label={r.kind === 'EMERGENCY' ? t('kindEmergency') : t('kindNormal')}
          />
          {r.viewOnly && <span className="text-caption text-text-secondary">{t('viewOnly')}</span>}
        </span>
      ),
    },
    {
      id: 'changes',
      header: t('colChanges'),
      align: 'end',
      accessorFn: (r) => t('changes', { count: r.changedCount }),
    },
    {
      id: 'end',
      header: t('colAction'),
      pinned: true,
      card: 'actions',
      accessorFn: (r) =>
        r.status === 'ACTIVE' ? (
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="success" label={t('live')} />
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => setEndTarget(r)}
            >
              {t('end')}
              <span className="sr-only"> {r.personName}</span>
            </Button>
          </span>
        ) : null,
    },
  ];

  const actionColumns: DataTableColumn<PlatformActionItem>[] = [
    { id: 'when', header: t('colWhen'), accessorFn: (r) => when(r.at) },
    { id: 'done', header: t('colDone'), accessorFn: (r) => r.label },
    { id: 'reason', header: t('colReason'), accessorFn: (r) => r.reason ?? '' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-h3">{t('historyTitle')}</h3>
        <div className="mt-3">
          <DataTable
            tableId="support-access-sessions"
            caption={t('historyCaption')}
            columns={sessionColumns}
            data={sessions ?? []}
            getRowId={(r) => r.id}
            sorting={null}
            onSortingChange={noSort}
            totalCount={sessions?.length ?? 0}
            paginated={false}
            loading={loading}
            {...(errorText ? { error: errorText } : {})}
            emptyMessage={t('historyEmpty')}
          />
        </div>
      </div>
      <div>
        <h3 className="text-h3">{t('platformTitle')}</h3>
        <div className="mt-3">
          <DataTable
            tableId="support-access-platform-actions"
            caption={t('platformCaption')}
            columns={actionColumns}
            data={platformActions ?? []}
            getRowId={(r) => r.id}
            sorting={null}
            onSortingChange={noSort}
            totalCount={platformActions?.length ?? 0}
            paginated={false}
            loading={loading}
            {...(errorText ? { error: errorText } : {})}
            emptyMessage={t('platformEmpty')}
          />
        </div>
      </div>
      {endFailed && (
        <p role="alert" className="font-medium text-status-overdue-fg">
          {t('endError')}
        </p>
      )}
      <ConfirmDialog
        open={endTarget !== null}
        onOpenChange={(open) => {
          if (!open) setEndTarget(null);
        }}
        title={t('endTitle')}
        description={t('endBody', { person: endTarget?.personName ?? '' })}
        confirmLabel={t('end')}
        busy={ending}
        onConfirm={() => {
          if (endTarget) onEnd(endTarget.id);
          setEndTarget(null);
        }}
      />
    </div>
  );
}
