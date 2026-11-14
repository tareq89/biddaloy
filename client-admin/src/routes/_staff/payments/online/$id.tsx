import { PaymentProofRejectReason, PaymentSubmissionStatus } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import {
  Button,
  ErrorState,
  ImageViewer,
  NoticeBar,
  RoutePending,
  Skeleton,
  StatusBadge,
  Timeline,
  toast,
  type ImageViewerFile,
  type StatusTone,
} from '@biddaloy/ui/components';
import {
  useConfirmPaymentProof,
  usePaymentSubmission,
  useStudent,
  type ProofReviewDetail,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatDateTime,
  formatPhone,
  formatServerAmount,
  parseServerDate,
} from '@biddaloy/ui/utils';
import { useQueries } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Check, MessageSquare, Phone, TriangleAlert, X } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { RejectProofDialog } from './-reject-dialog';

/**
 * `/payments/online/$id` — [3.4.x] one payment proof, full page. Confirm & next is the one
 * primary and takes initial focus; Reject, Call and Send SMS sit beside it.
 * Money moves only on the server's say-so: the page never computes a settlement.
 */
export const Route = createFileRoute('/_staff/payments/online/$id')({
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('onlinePayments', 'payments', 'common'),
  pendingComponent: ReviewPending,
  component: ReviewPage,
});

const CARD_CLASS = 'rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5';

const STATUS_TONE: Record<PaymentSubmissionStatus, StatusTone> = {
  PENDING: 'warning',
  CONFIRMED: 'success',
  COMPLETED: 'success',
  REJECTED: 'danger',
  DISCARDED: 'neutral',
  WITHDRAWN: 'neutral',
  FAILED: 'danger',
  CANCELLED: 'neutral',
  EXPIRED: 'neutral',
  REVERSED: 'neutral',
};

function ReviewPage() {
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <Review />
    </RegionConfigProvider>
  );
}

/** Files stream behind auth, so they arrive as blobs and are shown through object URLs. */
function useProofFiles(detail: ProofReviewDetail | undefined) {
  const { t } = useTranslation('onlinePayments');
  const results = useQueries({
    queries: (detail?.files ?? []).map((file) => ({
      queryKey: ['payment-submissions', 'file', detail?.id, file.id] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (
          await apiClient.get<Blob>(`/payment-submissions/${detail?.id}/files/${file.id}`, {
            responseType: 'blob',
            signal,
          })
        ).data,
      staleTime: Infinity,
      retry: false,
    })),
  });
  const blobs = results.map((r) => r.data);
  const [urls, setUrls] = React.useState<(string | undefined)[]>([]);
  React.useEffect(() => {
    const made = blobs.map((b) => (b ? URL.createObjectURL(b) : undefined));
    setUrls(made);
    return () => made.forEach((u) => u && URL.revokeObjectURL(u));
    // blobs identity changes only when a fetch lands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results.map((r) => r.dataUpdatedAt).join(',')]);

  const files: ImageViewerFile[] = (detail?.files ?? []).flatMap((file, i) => {
    const url = urls[i];
    return url
      ? [
          {
            url,
            contentType: file.contentType,
            label: t('review.fileLabel', { n: i + 1 }),
          },
        ]
      : [];
  });
  return {
    files,
    failed: results.some((r) => r.isError),
    loading: results.some((r) => r.isPending),
  };
}

function Review() {
  const { id } = Route.useParams();
  const { t } = useTranslation('onlinePayments');
  const { t: tPayments } = useTranslation('payments');
  const regionConfig = useRegionConfig();
  const navigate = useNavigate();
  const query = usePaymentSubmission(id);
  const detail = query.data;
  const confirm = useConfirmPaymentProof();
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const confirmRef = React.useRef<HTMLButtonElement>(null);
  const proofFiles = useProofFiles(detail);

  const close = useCloseFullPage(() => void navigate({ to: '/payments/online' }));

  // The guardian row id is not in the review answer (only the user id): read it off the
  // student's guardians. Without a match the Send SMS button stays off.
  const studentQuery = useStudent(detail?.bills[0]?.studentId);
  const guardianRowId = studentQuery.data?.guardians.find(
    (g) => g.user_id === detail?.guardian.userId,
  )?.id;

  const isWaiting = detail?.status === PaymentSubmissionStatus.PENDING;
  React.useEffect(() => {
    if (isWaiting) confirmRef.current?.focus();
  }, [isWaiting, id]);

  function goNext(nextId: string | null | undefined) {
    if (nextId) void navigate({ to: '/payments/online/$id', params: { id: nextId } });
    else void navigate({ to: '/payments/online' });
  }

  function onConfirm() {
    if (!detail) return;
    confirm.mutate(detail.id, {
      onSuccess: (result) => {
        if (result.outcome === 'DISCARDED') toast.warning(t('review.discarded'));
        else toast.success(t('review.confirmed'));
        goNext(result.detail.next_pending_id ?? detail.next_pending_id);
      },
    });
  }

  if (query.isPending) {
    return (
      <FullPageShell
        title={t('review.title')}
        onClose={close}
        closeLabel={t('review.close')}
        size="wide"
      >
        <div aria-busy="true" aria-label={t('review.loading')} className="flex flex-col gap-3">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-40 w-full" />
        </div>
      </FullPageShell>
    );
  }
  if (query.isError || !detail) {
    return (
      <FullPageShell
        title={t('review.title')}
        onClose={close}
        closeLabel={t('review.close')}
        size="wide"
      >
        <ErrorState
          message={t('review.error')}
          retryLabel={t('review.retry')}
          onRetry={() => void query.refetch()}
        />
      </FullPageShell>
    );
  }

  const students = [...new Set(detail.bills.map((b) => b.studentName))];
  const total = detail.bills.reduce((sum, b) => sum + Number(b.amount), 0);
  const phone = detail.guardian.phone;
  const paymentIds = [...new Set(detail.bills.flatMap((b) => (b.paymentId ? [b.paymentId] : [])))];
  const isConfirmed = detail.status === PaymentSubmissionStatus.CONFIRMED;
  const reasonLabel = (code: string | null) =>
    code && (Object.values(PaymentProofRejectReason) as string[]).includes(code)
      ? t(`reject.reasons.${code}`)
      : undefined;

  const events = detail.events.map((event, index) => {
    const actor =
      event.actorUserId === null
        ? t('review.historyUnknownActor')
        : event.actorUserId === detail.guardian.userId
          ? t('review.historyGuardian')
          : t('review.historyStaff');
    const reason = reasonLabel(event.reasonCode);
    const body =
      reason || event.note ? (
        <span className="text-text-secondary">
          {[reason, event.note].filter(Boolean).join(' · ')}
        </span>
      ) : undefined;
    return {
      id: `${index}-${event.createdAt}`,
      title: actor,
      time: event.createdAt,
      tone: STATUS_TONE[event.toStatus],
      badge: t(`review.status.${event.toStatus}`),
      ...(body ? { body } : {}),
    };
  });

  return (
    <FullPageShell
      title={t('review.title')}
      onClose={close}
      closeLabel={t('review.close')}
      size="wide"
    >
      <div className="grid gap-6 md:grid-cols-5">
        <div className="space-y-3 md:col-span-2">
          <h2 className="sr-only">{t('review.files')}</h2>
          {detail.files.length === 0 ? (
            <p className="text-text-secondary">{t('review.noFiles')}</p>
          ) : proofFiles.failed ? (
            <p role="alert" className="text-destructive">
              {t('review.filesError')}
            </p>
          ) : proofFiles.loading ? (
            <Skeleton className="aspect-[3/4] w-full" />
          ) : (
            <ImageViewer
              files={proofFiles.files}
              labels={{
                openFile: t('review.viewer.openFile'),
                zoomIn: t('review.viewer.zoomIn'),
                zoomOut: t('review.viewer.zoomOut'),
                previous: t('review.viewer.previous'),
                next: t('review.viewer.next'),
              }}
            />
          )}
        </div>

        <div className="space-y-4 md:col-span-3">
          <section className={CARD_CLASS}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-h2">
                  {t('review.guardianOf', { names: students.join(', ') })}
                </h2>
                <p className="text-text-secondary">
                  {detail.guardian.name}
                  {phone ? (
                    <>
                      {' · '}
                      <span dir="ltr">{formatPhone(phone, regionConfig)}</span>
                    </>
                  ) : null}
                  {' · '}
                  {t('review.submittedAt', {
                    when: formatDateTime(detail.createdAt, regionConfig),
                  })}
                </p>
              </div>
              <StatusBadge
                tone={STATUS_TONE[detail.status]}
                label={t(`review.status.${detail.status}`)}
              />
            </div>
            <dl className="mt-4 grid gap-3 md:grid-cols-2">
              <div>
                <dt className="text-label text-text-secondary">{t('review.method')}</dt>
                <dd>
                  {detail.method
                    ? tPayments(`record.method.methods.${detail.method}`)
                    : t('review.none')}
                </dd>
              </div>
              <div>
                <dt className="text-label text-text-secondary">{t('review.trxId')}</dt>
                <dd className="font-medium tabular-nums">{detail.reference ?? t('review.none')}</dd>
              </div>
              <div>
                <dt className="text-label text-text-secondary">{t('review.amount')}</dt>
                <dd className="font-medium tabular-nums">
                  {formatServerAmount(detail.amount, regionConfig)}
                </dd>
              </div>
              <div>
                <dt className="text-label text-text-secondary">{t('review.paidOn')}</dt>
                <dd>
                  {detail.paidOn
                    ? formatDate(parseServerDate(detail.paidOn), regionConfig)
                    : t('review.none')}
                </dd>
              </div>
            </dl>
            {detail.status === PaymentSubmissionStatus.REJECTED &&
            reasonLabel(detail.rejectReason) ? (
              <p className="mt-3 text-text-secondary">
                {t('review.rejectedBecause', { reason: reasonLabel(detail.rejectReason) })}
                {detail.rejectNote ? ` · ${detail.rejectNote}` : ''}
              </p>
            ) : null}
            <div className="mt-4 flex flex-col gap-2">
              {detail.duplicateFlag ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md bg-status-partial-bg p-3 text-status-partial-fg"
                >
                  <TriangleAlert aria-hidden className="mt-0.5 shrink-0" />
                  <p>{t(`review.flags.${detail.duplicateFlag}`)}</p>
                </div>
              ) : null}
              {detail.billAlreadyPaid ? (
                <NoticeBar tone="warning">{t('review.flags.billAlreadyPaid')}</NoticeBar>
              ) : null}
            </div>
          </section>

          <section className={CARD_CLASS}>
            <h2 className="text-h2">{t('review.bills')}</h2>
            <ul className="mt-2 divide-y divide-border-subtle">
              {detail.bills.map((bill) => (
                <li key={bill.studentFeeId} className="flex justify-between gap-3 py-2">
                  <span className="font-medium">{bill.studentName}</span>
                  <span className="font-medium tabular-nums">
                    {formatServerAmount(bill.amount, regionConfig)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2 flex justify-between border-t border-border-subtle pt-2 text-h3">
              <span>{t('review.billsTotal')}</span>
              <span className="tabular-nums">{formatServerAmount(total, regionConfig)}</span>
            </p>
          </section>

          <section className={CARD_CLASS}>
            <h2 className="text-h2">{t('review.history')}</h2>
            <Timeline items={events} aria-label={t('review.historyLabel')} />
          </section>
        </div>
      </div>

      <div className="sticky bottom-0 -mx-4 mt-6 border-t border-border-subtle bg-surface px-4 py-3 md:-mx-6 md:px-6">
        {confirm.isError ? (
          <p role="alert" className="mb-2 text-destructive">
            {t('review.confirmError')}
          </p>
        ) : null}
        {isConfirmed && paymentIds.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {paymentIds.map((paymentId) => (
              <Button key={paymentId} variant="outline" className="h-11" asChild>
                <Link to="/payments/$id" params={{ id: paymentId }}>
                  {t('review.actions.reverse')}
                </Link>
              </Button>
            ))}
          </div>
        ) : null}
        {isWaiting ? (
          <div className="flex flex-col-reverse gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => setRejectOpen(true)}
              >
                <X aria-hidden />
                {t('review.actions.reject')}
              </Button>
              {phone ? (
                <Button variant="outline" className="h-11" asChild>
                  <a
                    href={`tel:${phone}`}
                    aria-label={t('review.actions.callLabel', {
                      name: detail.guardian.name,
                      phone: formatPhone(phone, regionConfig),
                    })}
                  >
                    <Phone aria-hidden />
                    {t('review.actions.call')}
                  </a>
                </Button>
              ) : null}
              {guardianRowId ? (
                <Button variant="outline" className="h-11" asChild>
                  <Link to="/communications/send" search={{ to: `guardian:${guardianRowId}` }}>
                    <MessageSquare aria-hidden />
                    {t('review.actions.sms')}
                  </Link>
                </Button>
              ) : null}
            </div>
            <Button
              ref={confirmRef}
              type="button"
              className="h-11 w-full md:w-auto"
              loading={confirm.isPending}
              onClick={onConfirm}
            >
              <Check aria-hidden />
              {detail.next_pending_id
                ? t('review.actions.confirm')
                : t('review.actions.confirmLast')}
            </Button>
          </div>
        ) : null}
      </div>

      {rejectOpen && (
        <RejectProofDialog
          open
          onOpenChange={setRejectOpen}
          proofId={detail.id}
          onRejected={(rejected) => goNext(rejected.next_pending_id ?? detail.next_pending_id)}
        />
      )}
    </FullPageShell>
  );
}

function ReviewPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}
