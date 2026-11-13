/**
 * [99.G4.04] `/support-access/requests/$requestId` — a school admin approves or denies a Biddaloy
 * support request (D21). Reached from the alert link and the SMS/email link. Opening it only
 * reads: state changes on a button press, and the first answer is final (the server refuses a
 * second one). A request that is not this school's is "not found", never a hint it exists.
 */
import { ApiError } from '@biddaloy/ui/api';
import { Button, Card, RoutePending } from '@biddaloy/ui/components';
import {
  useDecideSupportRequest,
  useSupportRequest,
  type SupportRequestItem,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { formatDateTime } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';

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
  const { t: tAuth } = useTranslation('auth');
  const region = useRegionConfig();
  // By id on the server (this school only), so a request outside any list page still opens.
  const found = useSupportRequest(requestId);
  const decide = useDecideSupportRequest();
  const request = found.data;
  const missing = found.error instanceof ApiError && found.error.statusCode === 404;

  let body: React.ReactNode;
  if (found.isError && !missing) {
    body = (
      <div role="alert">
        <p>{t('loadError')}</p>
        <Button type="button" className="mt-4 h-11" onClick={() => void found.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  } else if (found.isPending) {
    body = (
      <p role="status" className="text-text-secondary">
        {t('reqLoading')}
      </p>
    );
  } else if (!request || missing) {
    body = (
      <>
        <h1 className="text-h2">{t('reqNotFound')}</h1>
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
    // The mutation result outlives navigation to another request: only this request's counts.
    const answered = decide.data?.id === request.id ? decide.data.status : undefined;
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
            : t('reqAsk', {
                person: request.personName,
                role: tAuth(`schoolPicker.roles.${request.role}`),
              })}
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
