/**
 * `/communications/batches/$batchId` — one batch's fate, live: header
 * counts + status, per-recipient delivery logs, the recipients skipped
 * before anything was queued, and **Retry failed**.
 *
 * Polling: `reminderBatchQueryOptions`'s `refetchInterval` re-asks the
 * server every `REMINDER_BATCH_POLL_MS` **only while the batch is
 * PROCESSING** and stops the moment it settles — the AC's "polling runs
 * only while the batch is in progress", owned by the query options so
 * every consumer of the batch gets the same behavior.
 *
 * Retry needs no server endpoint: it walks every page of the logs for
 * FAILED rows (`collectFailedStudentIds` — fresh reads, never the cache:
 * a stale page must not decide who gets re-messaged), then composes a
 * fresh `POST /reminder/bulk` with exactly those students and this
 * batch's own stored template, as a new batch named "Retry of …".
 */
import { ApiError, getActiveTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DataTable,
  ErrorState,
  RoutePending,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  collectFailedStudentIds,
  reminderBatchLogsKeyPrefix,
  reminderBatchQueryOptions,
  useReminderBatch,
  useReminderBatchLogs,
  useSendBulkReminder,
  type ReminderBatchLog,
  type ReminderBatchResponse,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { DetailShell } from '@biddaloy/ui/shells';
import { formatDate, formatNumber, formatPhone } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { CircleAlertIcon, RotateCcwIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { deliveryErrorKey } from '../-shared/delivery-error';
import { skipReasonKey } from '../-shared/skip-reason';
import { TemplatePreview } from '../-shared/template-preview';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../../../route-loaders';

/** SendBulkReminderDto caps batch_name at 200 characters. */
const MAX_BATCH_NAME = 200;

/**
 * Names the retry batch. A batch sitting near the 200-character cap — or a
 * retry of a retry, which stacks another prefix — would otherwise come back
 * as a bare 400 the sender cannot act on, so the *name* is trimmed until
 * the prefixed result fits.
 */
function buildRetryName(t: TFunction<'communications'>, name: string): string {
  const full = t('batches.detail.retryNamePrefix', { name });
  if (full.length <= MAX_BATCH_NAME) return full;
  const overflow = full.length - MAX_BATCH_NAME;
  const trimmed = `${name.slice(0, Math.max(0, name.length - overflow - 1))}…`;
  return t('batches.detail.retryNamePrefix', { name: trimmed }).slice(0, MAX_BATCH_NAME);
}

const LOGS_PAGE_SIZE = 25;

const batchDetailSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/communications/batches/$batchId')({
  validateSearch: batchDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient
        .ensureQueryData(reminderBatchQueryOptions(params.batchId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('communications'),
    ]),
  pendingComponent: BatchDetailPending,
  component: BatchDetailPage,
});

// [8.14.17]: the permission check that used to live at the top of
// `BatchDetailPage` (an `EmptyState` shown when the viewer lacked
// `COMMUNICATION_BULK_SEND`) is gone — `_staff.tsx`'s `RequirePermission`
// now refuses the whole route in place, keyed off the same permission
// (`route-permissions.ts`), before this component ever mounts.
function BatchDetailPage() {
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <BatchDetail />
    </RegionConfigProvider>
  );
}

function BatchDetail() {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  const navigate = useNavigate();
  const { batchId } = Route.useParams();
  const { page = 1 } = Route.useSearch();

  const queryClient = useQueryClient();
  const batchQuery = useReminderBatch(batchId);
  // The header polls while the batch is PROCESSING; without the same
  // treatment the table below froze on its first page of QUEUED rows, so a
  // batch could show "48 sent, 2 failed" above a table claiming all 50 were
  // still queued — and "Retry failed" looked like a no-op.
  const batchStatus = batchQuery.data?.status;
  const logsQuery = useReminderBatchLogs(
    batchId,
    { page, limit: LOGS_PAGE_SIZE },
    { poll: batchStatus === 'PROCESSING' },
  );

  // Polling stops on the settled response, so the last page the table holds
  // can predate the final statuses. Refetch once on the transition out of
  // PROCESSING to reconcile it.
  const previousStatus = React.useRef<typeof batchStatus>(undefined);
  // [8.14.11] One bell entry per batch, ever. A refocus refetch can re-run
  // this effect against the same terminal status; without an id set here,
  // a user leaving the tab open would collect a new notification each time.
  const notifiedBatchIds = React.useRef(new Set<string>());
  React.useEffect(() => {
    if (previousStatus.current === 'PROCESSING' && batchStatus && batchStatus !== 'PROCESSING') {
      void queryClient.invalidateQueries({ queryKey: reminderBatchLogsKeyPrefix(batchId) });

      if (!notifiedBatchIds.current.has(batchId)) {
        notifiedBatchIds.current.add(batchId);
        const successfulCount = batchQuery.data?.successful_count ?? 0;
        const failedCount = batchQuery.data?.failed_count ?? 0;
        // `tenantId: null` is deliberate, not a capture-before-request
        // omission: unlike the other producers, this notification fires
        // from a poll on an already-mounted route, whose tenant page is
        // currently mounted, so a tenant switch unmounts this route.
        notifyOutcome({
          tenantId: getActiveTenant(),
          variant: failedCount > 0 ? 'error' : 'success',
          message:
            failedCount > 0
              ? t('notifications.batchFailed', { failed: formatNumber(failedCount, config) })
              : t('notifications.batchCompleted', {
                  sent: formatNumber(successfulCount, config),
                }),
        });
      }
    }
    previousStatus.current = batchStatus;
  }, [batchStatus, batchId, queryClient, batchQuery.data, t, config]);

  const [retryOpen, setRetryOpen] = React.useState(false);
  const [retryPreparing, setRetryPreparing] = React.useState(false);
  const [retryError, setRetryError] = React.useState<string | null>(null);
  const send = useSendBulkReminder();

  const batch = batchQuery.data;

  async function handleRetryConfirm(current: ReminderBatchResponse) {
    if (current.message_template === null) return;
    const template = current.message_template;
    setRetryPreparing(true);
    setRetryError(null);
    try {
      const studentIds = await collectFailedStudentIds(current.id);
      if (studentIds.length === 0) {
        setRetryError(t('batches.detail.retryNothingFailed'));
        return;
      }
      send.mutate(
        {
          student_ids: studentIds,
          message_template: template,
          batch_name: buildRetryName(t, current.batch_name),
          // Replay the original targeting. Omitting `mediums` would let the
          // server fall back to each guardian's preferred channel, so an
          // email-only batch would retry onto SMS and WhatsApp; omitting the
          // approved template would turn a WhatsApp retry into freeform text
          // Meta rejects outside its 24-hour window — the very failure being
          // retried. Spread rather than `?? undefined` because the request
          // type omits these keys (exactOptionalPropertyTypes) instead of
          // allowing an explicit undefined.
          ...(current.mediums ? { mediums: current.mediums } : {}),
          ...(current.whatsapp_template_name
            ? { whatsapp_template_name: current.whatsapp_template_name }
            : {}),
          ...(current.whatsapp_template_language
            ? { whatsapp_template_language: current.whatsapp_template_language }
            : {}),
          ...(current.whatsapp_template_params
            ? { whatsapp_template_params: current.whatsapp_template_params }
            : {}),
        },
        {
          onSuccess: (created) => {
            setRetryOpen(false);
            void navigate({
              to: '/communications/batches/$batchId',
              params: { batchId: created.id },
            });
          },
          onError: (error) => {
            setRetryError(
              error instanceof ApiError && error.statusCode === 429
                ? t('bulk.review.rateLimited')
                : t('batches.detail.retryErrorMessage'),
            );
          },
        },
      );
    } catch {
      setRetryError(t('batches.detail.retryErrorMessage'));
    } finally {
      setRetryPreparing(false);
    }
  }

  const logColumns: DataTableColumn<ReminderBatchLog>[] = [
    {
      id: 'recipient',
      header: t('batches.detail.recipientHeader'),
      accessorFn: (row) => <span className="font-medium">{row.recipient_name}</span>,
      pinned: true,
      card: 'title',
    },
    {
      id: 'channel',
      header: t('batches.detail.channelHeader'),
      accessorFn: (row) => t(`mediums.${row.medium}`),
    },
    {
      id: 'address',
      header: t('batches.detail.addressHeader'),
      accessorFn: (row) =>
        row.medium === 'EMAIL' ? row.recipient_address : formatPhone(row.recipient_address, config),
    },
    {
      id: 'status',
      header: t('batches.detail.statusHeader'),
      accessorFn: (row) => <StatusBadge domain="communication" status={row.status} />,
      card: 'badge',
    },
    {
      id: 'error',
      header: t('batches.detail.errorHeader'),
      accessorFn: (row) => {
        const key = deliveryErrorKey(row.error);
        if (key === null) return '—';
        return (
          <span className="flex items-start gap-1.5 text-status-overdue-fg">
            <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(key, { medium: t(`mediums.${row.medium}`) })}
          </span>
        );
      },
    },
  ];

  // Skipped recipients grouped by reason — a raw list of UUIDs is not
  // reviewable, but "no guardians on file × 3" is actionable.
  const skippedByReason = new Map<string, number>();
  for (const entry of batch?.skipped ?? []) {
    skippedByReason.set(entry.reason, (skippedByReason.get(entry.reason) ?? 0) + 1);
  }

  if (batchQuery.isError && batchQuery.data === undefined) {
    return (
      <ErrorState
        message={t('batches.detail.loadError')}
        onRetry={() => void batchQuery.refetch()}
      />
    );
  }

  if (batch === undefined) {
    return <BatchDetailPending />;
  }

  const canRetry = batch.status !== 'PROCESSING' && batch.failed_count > 0;

  return (
    <DetailShell
      name={batch.batch_name}
      statusBadge={<StatusBadge domain="reminderBatch" status={batch.status} />}
      facts={[
        {
          label: t('batches.detail.createdLabel'),
          value: formatDate(new Date(batch.created_at), config),
        },
        {
          label: t('batches.detail.totalLabel'),
          value: formatNumber(batch.total_recipients, config),
        },
        {
          label: t('batches.detail.successLabel'),
          value: formatNumber(batch.successful_count, config),
        },
        {
          label: t('batches.detail.failedLabel'),
          value: formatNumber(batch.failed_count, config),
        },
      ]}
      actions={
        canRetry && batch.message_template !== null
          ? [
              {
                id: 'retry',
                label: t('batches.detail.retryAction'),
                icon: <RotateCcwIcon aria-hidden />,
                priority: 'primary',
                onClick: () => setRetryOpen(true),
              },
            ]
          : []
      }
    >
      {batch.message_template !== null && (
        <Card padded aria-labelledby="batch-template-title">
          <h2 id="batch-template-title" className="text-h2">
            {t('batches.detail.templateLabel')}
          </h2>
          <TemplatePreview template={batch.message_template} />
        </Card>
      )}
      {canRetry && batch.message_template === null && (
        <p className="text-text-secondary">{t('batches.detail.retryNoTemplate')}</p>
      )}

      <section aria-label={t('batches.detail.logsTitle')} className="space-y-3">
        <h2 className="text-h2">{t('batches.detail.logsTitle')}</h2>
        <DataTable
          tableId="reminder-batch-logs"
          caption={t('batches.detail.logsCaption')}
          columns={logColumns}
          data={logsQuery.data?.data ?? []}
          getRowId={(row) => row.id}
          sorting={null}
          onSortingChange={() => undefined}
          page={page}
          pageSize={LOGS_PAGE_SIZE}
          totalCount={logsQuery.data?.total ?? 0}
          onPageChange={(nextPage) =>
            void navigate({
              to: '.',
              search: (prev: Record<string, unknown>) => ({ ...prev, page: nextPage }),
            })
          }
          loading={logsQuery.isPending}
          // [8.14.6] Not plain `logsQuery.isFetching`: this query polls
          // every `REMINDER_BATCH_POLL_MS` while the batch is
          // PROCESSING (see `useReminderBatchLogs` above), so raw
          // `isFetching` flips true/false on every poll tick and would
          // dim/undim this table every few seconds — the opposite of
          // the calm, stable table this ticket exists to ship.
          // `isPlaceholderData` is only true while a *stale key's* rows
          // are on screen (a real filter/page/sort change), never
          // during a same-key background poll, so gating on it keeps
          // the dim reserved for user-initiated transitions. Plan's own
          // documented escape hatch for this exact interaction.
          isFetching={logsQuery.isFetching && logsQuery.isPlaceholderData}
          {...(logsQuery.isError ? { error: t('batches.detail.logsError') } : {})}
          emptyState={{
            title: t('batches.detail.logsEmpty'),
            explanation: t('batches.detail.logsEmptyHelp'),
          }}
        />
      </section>

      <Card padded aria-labelledby="batch-skipped-title">
        <h2 id="batch-skipped-title" className="text-h2">
          {t('batches.detail.skippedTitle', { n: formatNumber(batch.skipped.length, config) })}
        </h2>
        {batch.skipped.length === 0 ? (
          <p className="mt-1 text-text-secondary">{t('batches.detail.noneSkipped')}</p>
        ) : (
          <ul className="mt-2 divide-y divide-border-subtle">
            {Array.from(skippedByReason.entries()).map(([reason, count]) => (
              <li
                key={reason}
                className="flex flex-col gap-0.5 py-3 md:flex-row md:justify-between md:gap-4"
              >
                <span>{t(skipReasonKey(reason))}</span>
                <span className="text-text-secondary">
                  {t('batches.detail.skippedStudents', { count, n: formatNumber(count, config) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Dialog
        open={retryOpen}
        onOpenChange={(open) => {
          setRetryOpen(open);
          if (!open) setRetryError(null);
        }}
      >
        <DialogContent size="md" closeLabel={t('actions.close', { ns: 'common' })}>
          <DialogHeader>
            <DialogTitle>{t('batches.detail.retryTitle')}</DialogTitle>
            <DialogDescription>
              {t('batches.detail.retryDescription', {
                name: buildRetryName(t, batch.batch_name),
              })}
            </DialogDescription>
            {/*
              The send endpoint takes student ids, not guardian ids, and
              re-resolves every guardian of each student. A student whose
              mother's SMS succeeded and father's failed therefore gets
              both messaged again — say so before the sender confirms,
              because nothing about "retry failed" implies it.
            */}
            <p className="text-text-secondary">
              {t('batches.detail.retryResendWarning', {
                count: batch.failed_count,
                n: formatNumber(batch.failed_count, config),
              })}
            </p>
          </DialogHeader>
          {retryError !== null && (
            <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
              {retryError}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('batches.detail.retryCancel')}
              </Button>
            </DialogClose>
            <Button
              type="button"
              loading={retryPreparing || send.isPending}
              disabled={retryPreparing || send.isPending}
              onClick={() => void handleRetryConfirm(batch)}
            >
              {retryPreparing || send.isPending
                ? t('batches.detail.retryPreparing')
                : t('batches.detail.retryConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DetailShell>
  );
}

function BatchDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
