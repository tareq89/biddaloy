/**
 * [99.G4.04] `/support-access/requests/$requestId` — a school admin approves or denies a Biddaloy
 * support request (D21). Reached from the alert link and the SMS/email link. Opening it only
 * reads: state changes on a button press, and the first answer is final (the server refuses a
 * second one). A request that is not this school's is "not found", never a hint it exists.
 */
import { Button, Card, RoutePending } from '@biddaloy/ui/components';
import {
  useDecideSupportRequest,
  useSupportRequests,
  type SupportRequestItem,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { formatDateTime } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';

import { roleLabel } from '../../../pages/settings/SupportAccessSessionsList';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/support-access/requests/$requestId')({
  loader: () => loadRouteNamespaces('supportAccess', 'settings'),
  pendingComponent: RequestPending,
  component: SupportRequestPage,
});

function RequestPending() {
  const { t } = useTranslation('supportAccess');
  return <RoutePending variant="detail" label={t('reqLoading')} />;
}

/** The sentence under the card once nothing more can be pressed; `undefined` = still open. */
function closedText(
  request: SupportRequestItem,
  t: (key: string) => string,
  now = Date.now(),
): string | undefined {
  if (request.status === 'APPROVED') return t('reqAlreadyApproved');
  if (request.status === 'DENIED') return t('reqAlreadyDenied');
  if (
    request.status === 'EXPIRED' ||
    (request.expiresAt !== null && new Date(request.expiresAt).getTime() <= now)
  ) {
    return t('reqExpired');
  }
  return undefined;
}

function SupportRequestPage() {
  const { requestId } = Route.useParams();
  const { t } = useTranslation('supportAccess');
  const region = useRegionConfig();
  // The list defaults to waiting requests only; an answered or run-out link is in "decided".
  const pending = useSupportRequests({ status: 'pending', limit: 100 });
  const decided = useSupportRequests({ status: 'decided', limit: 100 });
  const requests = {
    isError: pending.isError || decided.isError,
    refetch: () => Promise.all([pending.refetch(), decided.refetch()]),
    data: pending.data && decided.data ? [...pending.data, ...decided.data] : undefined,
  };
  const decide = useDecideSupportRequest();
  const request = requests.data?.find((r) => r.id === requestId);

  let body: React.ReactNode;
  if (requests.isError) {
    body = (
      <div role="alert">
        <p>{t('loadError')}</p>
        <Button type="button" className="mt-4 h-11" onClick={() => void requests.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  } else if (!requests.data) {
    body = (
      <p role="status" className="text-text-secondary">
        {t('reqLoading')}
      </p>
    );
  } else if (!request) {
    body = (
      <>
        <p role="alert" className="font-medium">
          {t('reqNotFound')}
        </p>
        <Link
          to="/settings"
          search={{ section: 'support' }}
          className="mt-4 inline-flex h-11 items-center font-medium text-primary"
        >
          {t('reqBack')}
        </Link>
      </>
    );
  } else {
    const answered = decide.data?.status;
    const closed = answered
      ? answered === 'APPROVED'
        ? t('reqApproved')
        : t('reqDenied')
      : closedText(request, t);
    body = (
      <>
        <h1 className="text-h2">
          {request.kind === 'WRITE'
            ? t('reqWrite')
            : t('reqAsk', { person: request.personName, role: roleLabel(request.role) })}
        </h1>
        <dl className="mt-4 space-y-1">
          <div>
            <dt className="inline font-medium">{t('reqReason')}: </dt>
            <dd className="inline">{request.reason}</dd>
          </div>
        </dl>
        <p className="mt-1 text-text-secondary">
          {t('reqAsked', { when: formatDateTime(new Date(request.requestedAt), region) })}
          {request.expiresAt &&
            `. ${t('reqValid', { when: formatDateTime(new Date(request.expiresAt), region) })}`}
        </p>
        {closed ? (
          <p role="status" className="mt-5 font-medium">
            {closed}
          </p>
        ) : (
          <>
            <div className="mt-5 flex flex-col gap-3 md:flex-row-reverse md:justify-start">
              <Button
                type="button"
                className="h-11 w-full md:w-auto"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: request.id, decision: 'approve' })}
              >
                {t('approve')}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-full md:w-auto"
                disabled={decide.isPending}
                onClick={() => decide.mutate({ id: request.id, decision: 'deny' })}
              >
                {t('deny')}
              </Button>
            </div>
            <p className="mt-2 text-caption text-text-secondary">{t('firstAnswer')}</p>
          </>
        )}
        {decide.isError && (
          <p role="alert" className="mt-4 font-medium text-status-overdue-fg">
            {t('reqError')}
          </p>
        )}
      </>
    );
  }

  return (
    <PageContainer size="narrow">
      <Card padded>{body}</Card>
    </PageContainer>
  );
}
