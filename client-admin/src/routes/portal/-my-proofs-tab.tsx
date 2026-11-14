import { PaymentProofRejectReason, PaymentSubmissionStatus } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  ImageViewer,
  Skeleton,
  StatusBadge,
  toast,
  type StatusTone,
} from '@biddaloy/ui/components';
import {
  useCurrentUser,
  useMyPaymentProofs,
  useMyStudents,
  useWithdrawPaymentProof,
  type ProofSubmission,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount } from '@biddaloy/ui/utils';
import { useQueries } from '@tanstack/react-query';
import * as React from 'react';

const STATUS_TONE: Partial<Record<PaymentSubmissionStatus, StatusTone>> = {
  [PaymentSubmissionStatus.PENDING]: 'warning',
  [PaymentSubmissionStatus.CONFIRMED]: 'success',
  [PaymentSubmissionStatus.REJECTED]: 'danger',
  [PaymentSubmissionStatus.DISCARDED]: 'neutral',
  [PaymentSubmissionStatus.WITHDRAWN]: 'neutral',
};

/** The proof file route needs the bearer token, so an `<img src>` cannot reach it: fetch blobs. */
function useProofFileUrls(proof: ProofSubmission): (string | null)[] {
  const results = useQueries({
    queries: proof.files.map((file) => ({
      queryKey: ['payment-submissions', 'portal-file', proof.id, file.id] as const,
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        (
          await apiClient.get<Blob>(`/portal/payment-proofs/${proof.id}/files/${file.id}`, {
            responseType: 'blob',
            signal,
          })
        ).data,
      staleTime: Infinity,
    })),
  });
  const arrived = results.map((r) => (r.data ? '1' : '0')).join('');
  const urls = React.useMemo(
    () => results.map((r) => (r.data ? URL.createObjectURL(r.data) : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `arrived` tracks which blobs came in
    [arrived, proof.id],
  );
  React.useEffect(() => () => urls.forEach((u) => u && URL.revokeObjectURL(u)), [urls]);
  return urls;
}

function ProofFiles({ proof }: { proof: ProofSubmission }) {
  const { t } = useTranslation('portal');
  const urls = useProofFileUrls(proof);
  const files = proof.files.flatMap((file, i) => {
    const url = urls[i];
    return url
      ? [{ url, contentType: file.contentType, label: t('proofs.fileLabel', { n: i + 1 }) }]
      : [];
  });
  if (files.length === 0) return null;
  return (
    <ImageViewer
      files={files}
      labels={{
        openFile: t('proofs.viewer.openFile'),
        zoomIn: t('proofs.viewer.zoomIn'),
        zoomOut: t('proofs.viewer.zoomOut'),
        previous: t('proofs.viewer.previous'),
        next: t('proofs.viewer.next'),
      }}
    />
  );
}

function ProofCard({
  proof,
  studentName,
  canWithdraw,
  onWithdraw,
  config,
}: {
  proof: ProofSubmission;
  studentName: string;
  canWithdraw: boolean;
  onWithdraw: (proof: ProofSubmission) => void;
  config: RegionConfig;
}) {
  const { t } = useTranslation('portal');
  const { t: tCommon } = useTranslation('common');
  const status = proof.status as PaymentSubmissionStatus;
  const tone = STATUS_TONE[status] ?? 'neutral';
  const reason = proof.rejectReason as PaymentProofRejectReason | null;
  return (
    <Card className="space-y-2 p-4 md:p-5" data-testid="proof-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-h3">{studentName}</h3>
          <p className="font-semibold tabular-nums">{formatServerAmount(proof.amount, config)}</p>
        </div>
        <StatusBadge tone={tone} label={t(`proofs.status.${proof.status}`)} />
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption text-text-secondary">
        {proof.method && (
          <>
            <dt>{t('proofs.method')}</dt>
            <dd>
              {tCommon(`enums.paymentMethod.${proof.method}`, { defaultValue: proof.method })}
            </dd>
          </>
        )}
        {proof.reference && (
          <>
            <dt>{t('proofs.trxId')}</dt>
            <dd className="break-all">{proof.reference}</dd>
          </>
        )}
        <dt>{t('proofs.submittedOn')}</dt>
        <dd>{formatDate(proof.createdAt, config)}</dd>
      </dl>
      {/* A co-guardian's rejected row carries no reason: the badge stands alone. */}
      {status === PaymentSubmissionStatus.REJECTED && reason && (
        <p className="text-body">
          {t('proofs.reasonLabel')}: {t(`proofs.rejectReason.${reason}`)}
          {proof.rejectNote ? <> · {proof.rejectNote}</> : null}
        </p>
      )}
      {status === PaymentSubmissionStatus.DISCARDED && (
        <p className="text-body">{t('proofs.discardedExplanation')}</p>
      )}
      <ProofFiles proof={proof} />
      {canWithdraw && (
        <Button variant="outline" onClick={() => onWithdraw(proof)}>
          {t('proofs.withdraw')}
        </Button>
      )}
    </Card>
  );
}

/** [3.x/#3975] "My payment proofs": every proof for the guardian's children, newest first. */
export function MyProofsTab() {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const proofsQuery = useMyPaymentProofs();
  const studentsQuery = useMyStudents();
  const userId = useCurrentUser().data?.id;
  const withdraw = useWithdrawPaymentProof();
  const [target, setTarget] = React.useState<ProofSubmission | null>(null);

  if (proofsQuery.isPending || studentsQuery.isPending) {
    return (
      <div className="space-y-3" aria-busy="true">
        <span className="sr-only">{t('proofs.loading')}</span>
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }
  if (proofsQuery.isError || studentsQuery.isError) {
    return (
      <ErrorState
        message={t('proofs.error')}
        retryLabel={t('fees.error.retry')}
        onRetry={() => {
          void proofsQuery.refetch();
          void studentsQuery.refetch();
        }}
      />
    );
  }
  const proofs = proofsQuery.data;
  if (proofs.length === 0) {
    // A plain card, not EmptyState: its title is an <h1> and the page already owns one.
    return (
      <Card className="p-4 md:p-5">
        <p className="text-text-secondary">{t('proofs.empty')}</p>
      </Card>
    );
  }
  const names = new Map(studentsQuery.data.map((s) => [s.id, s.full_name]));
  const nameOf = (proof: ProofSubmission) =>
    proof.bills
      .map((b) => names.get(b.studentId))
      .filter((n, i, all): n is string => !!n && all.indexOf(n) === i)
      .join(', ');

  return (
    <div className="space-y-3">
      {proofs.map((proof) => (
        <ProofCard
          key={proof.id}
          proof={proof}
          studentName={nameOf(proof)}
          // Only the submitter, and only while waiting (D41); the server re-checks both.
          canWithdraw={
            !!userId &&
            proof.submittedByUserId === userId &&
            (proof.status as PaymentSubmissionStatus) === PaymentSubmissionStatus.PENDING
          }
          onWithdraw={setTarget}
          config={config}
        />
      ))}
      <ConfirmDialog
        open={target !== null}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('proofs.withdrawTitle')}
        description={t('proofs.withdrawDescription')}
        confirmLabel={t('proofs.withdraw')}
        tone="default"
        busy={withdraw.isPending}
        onConfirm={() => {
          if (!target) return;
          withdraw.mutate(target.id, {
            onSuccess: () => {
              toast.success(t('proofs.withdrawn'));
              setTarget(null);
            },
            onError: () => toast.error(t('proofs.withdrawError')),
          });
        }}
      />
    </div>
  );
}
