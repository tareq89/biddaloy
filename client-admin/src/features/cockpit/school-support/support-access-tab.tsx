/**
 * #3822 School 360, "Support access" tab. Shows the school's own setting (read only, D24: only a
 * school admin changes it) and the last 20 Login as visits to this school. The server has no
 * per-school visit list for owners, so this reads the recent list and keeps this school's rows.
 * Failures are fixed sentences; nothing server-sent is echoed (Rule 23).
 */
import {
  Button,
  Card,
  DataTable,
  ErrorState,
  Skeleton,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  useLoginAsCandidates,
  useLoginAsSessions,
  type ImpersonationSessionDto,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime } from '@biddaloy/ui/utils';

const TONE = { allowed: 'success', ask: 'warning', blocked: 'danger' } as const;
const VISITS_SHOWN = 20;

export interface SupportAccessTabProps {
  schoolId: string;
  /** Opens the Login as dialog (built by #3819). Hidden when not given. */
  onLoginAs?: () => void;
}

export function SupportAccessTab({ schoolId, onLoginAs }: SupportAccessTabProps) {
  const { t } = useTranslation('schoolSupport');
  const config = useRegionConfig();
  const setting = useLoginAsCandidates(schoolId);
  const visits = useLoginAsSessions({ scope: 'recent', limit: 100 });

  const rows = (visits.data ?? []).filter((v) => v.schoolId === schoolId).slice(0, VISITS_SHOWN);

  const columns: DataTableColumn<ImpersonationSessionDto>[] = [
    {
      id: 'who',
      header: t('supportAccess.columns.who'),
      accessorFn: (r) => r.platformAdminName,
      card: 'title',
    },
    {
      id: 'person',
      header: t('supportAccess.columns.person'),
      accessorFn: (r) => r.userName,
      card: 'subtitle',
    },
    {
      id: 'when',
      header: t('supportAccess.columns.when'),
      accessorFn: (r) => formatDateTime(r.startedAt ?? r.requestedAt, config),
      card: 'subtitle',
    },
    {
      id: 'reason',
      header: t('supportAccess.columns.reason'),
      accessorFn: (r) => r.reason,
      card: 'subtitle',
    },
    {
      id: 'viewOnly',
      header: t('supportAccess.columns.viewOnly'),
      accessorFn: (r) => (r.viewOnly ? t('supportAccess.yes') : t('supportAccess.no')),
      card: 'badge',
    },
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4 md:p-5">
        <h2 className="text-h3 font-semibold">{t('supportAccess.title')}</h2>
        {setting.isLoading ? (
          <Skeleton className="h-6 w-40" />
        ) : setting.isError || !setting.data ? (
          <ErrorState
            message={t('supportAccess.loadError')}
            retryLabel={t('supportAccess.retry')}
            onRetry={() => void setting.refetch()}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm text-muted-foreground">
              {t('supportAccess.settingLabel')}
            </span>
            <StatusBadge
              tone={TONE[setting.data.supportAccessMode]}
              label={t(`supportAccess.mode.${setting.data.supportAccessMode}`)}
            />
          </div>
        )}
        <p className="text-caption text-muted-foreground">{t('supportAccess.adminOnly')}</p>
        {onLoginAs && (
          <Button type="button" onClick={onLoginAs}>
            {t('supportAccess.loginAs')}
          </Button>
        )}
      </Card>
      <section className="space-y-2">
        <h2 className="text-h3 font-semibold">{t('supportAccess.visitsTitle')}</h2>
        <DataTable
          tableId="school-support-visits"
          caption={t('supportAccess.caption')}
          columns={columns}
          data={rows}
          getRowId={(r) => r.id}
          sorting={null}
          onSortingChange={() => undefined}
          paginated={false}
          totalCount={rows.length}
          loading={visits.isLoading}
          isFetching={visits.isFetching}
          emptyState={{
            title: t('supportAccess.empty'),
            explanation: t('supportAccess.emptyExplanation'),
          }}
          {...(visits.isError ? { error: t('supportAccess.loadVisitsError') } : {})}
        />
      </section>
    </div>
  );
}
