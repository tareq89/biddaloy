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
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DataTable,
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
import { formatDate } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import * as React from 'react';
import { z } from 'zod';

import { skipReasonKey } from '../-shared/skip-reason';
import { loadRouteNamespaces } from '../../../../route-loaders';

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

const LOGS_PAGE_SIZE = 50;

const batchDetailSearchSchema = z.object({
  page: z.number().int().positive().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/communications/batches/$batchId')({
  validateSearch: batchDetailSearchSchema,
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient.ensureQueryData(reminderBatchQueryOptions(params.batchId)).catch(() => undefined),
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
  React.useEffect(() => {
    if (previousStatus.current === 'PROCESSING' && batchStatus && batchStatus !== 'PROCESSING') {
      void queryClient.invalidateQueries({ queryKey: reminderBatchLogsKeyPrefix(batchId) });
    }
    previousStatus.current = batchStatus;
  }, [batchStatus, batchId, queryClient]);

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
      accessorFn: (row) => row.recipient_name,
      pinned: true,
    },
    {
      id: 'channel',
      header: t('batches.detail.channelHeader'),
      accessorFn: (row) => t(`mediums.${row.medium}`),
    },
    {
      id: 'address',
      header: t('batches.detail.addressHeader'),
      accessorFn: (row) => row.recipient_address,
    },
    {
      id: 'status',
      header: t('batches.detail.statusHeader'),
      accessorFn: (row) => <StatusBadge domain="communication" status={row.status} />,
    },
    {
      id: 'error',
      header: t('batches.detail.errorHeader'),
      accessorFn: (row) => row.error ?? '—',
    },
  ];

  // Skipped recipients grouped by reason — a raw list of UUIDs is not
  // reviewable, but "no guardians on file × 3" is actionable.
  const skippedByReason = new Map<string, number>();
  for (const entry of batch?.skipped ?? []) {
    skippedByReason.set(entry.reason, (skippedByReason.get(entry.reason) ?? 0) + 1);
  }

  if (batchQuery.isError) {
    return (
      <div className="p-4">
        <p role="alert" className="text-sm text-destructive">
          {t('batches.detail.loadError')}
        </p>
      </div>
    );
  }

  const canRetry = batch !== undefined && batch.status !== 'PROCESSING' && batch.failed_count > 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4">
      <div>
        <Link
          to="/communications/batches"
          // min-h-6 / min-w-6: the 24x24 CSS px floor the responsive
          // target-size spec enforces — the bare text link measured 35x16.
          className="inline-flex min-h-6 min-w-6 items-center self-start text-sm text-primary underline underline-offset-2"
        >
          {t('batches.detail.backToList')}
        </Link>
      </div>

      {batch === undefined ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : (
        <>
          <header className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-semibold">{batch.batch_name}</h1>
                <StatusBadge domain="reminderBatch" status={batch.status} />
              </div>
              {canRetry && batch.message_template !== null && (
                <Button type="button" onClick={() => setRetryOpen(true)}>
                  {t('batches.detail.retryAction')}
                </Button>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted-foreground">{t('batches.detail.createdLabel')}</dt>
                <dd>{formatDate(new Date(batch.created_at), config)}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('batches.detail.totalLabel')}</dt>
                <dd>{batch.total_recipients}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('batches.detail.successLabel')}</dt>
                <dd>{batch.successful_count}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t('batches.detail.failedLabel')}</dt>
                <dd>{batch.failed_count}</dd>
              </div>
            </dl>
            {batch.message_template !== null && (
              <div className="rounded-md border border-border-subtle p-3">
                <h2 className="text-sm font-semibold">{t('batches.detail.templateLabel')}</h2>
                <p className="mt-1 text-sm whitespace-pre-wrap">{batch.message_template}</p>
              </div>
            )}
            {canRetry && batch.message_template === null && (
              <p className="text-sm text-muted-foreground">{t('batches.detail.retryNoTemplate')}</p>
            )}
          </header>

          <section aria-label={t('batches.detail.logsTitle')} className="flex flex-col gap-2">
            <h2 className="text-lg font-medium">{t('batches.detail.logsTitle')}</h2>
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
              emptyMessage={t('batches.detail.logsEmpty')}
            />
          </section>

          <section
            aria-label={t('batches.detail.skippedTitle', { count: batch.skipped.length })}
            className="flex flex-col gap-2"
          >
            <h2 className="text-lg font-medium">
              {t('batches.detail.skippedTitle', { count: batch.skipped.length })}
            </h2>
            {batch.skipped.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('batches.detail.noneSkipped')}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {Array.from(skippedByReason.entries()).map(([reason, count]) => {
                  const reasonKey = skipReasonKey(reason);
                  return (
                    <li key={reason}>
                      {reasonKey !== undefined ? t(reasonKey) : reason} —{' '}
                      {t('batches.detail.skippedStudents', { count: count })}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <Dialog
            open={retryOpen}
            onOpenChange={(open) => {
              setRetryOpen(open);
              if (!open) setRetryError(null);
            }}
          >
            <DialogContent>
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
                <p className="text-sm text-muted-foreground">
                  {t('batches.detail.retryResendWarning', { count: batch.failed_count })}
                </p>
              </DialogHeader>
              {retryError !== null && (
                <p role="alert" className="text-sm text-destructive">
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
        </>
      )}
    </div>
  );
}

function BatchDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
