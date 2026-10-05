/**
 * [32.3.9] The page a printed ID card's QR code opens — `/v/<token>`. No login,
 * no session, no tenant, no `apiClient` call of any kind: `usePublicVerification`
 * uses bare axios (see `fetchPublicVerification`), same as the public invoice
 * page `/i/<token>`, and `__root.tsx` short-circuits its auth guard for `/v/`.
 *
 * It shows only what the server allows (D22): document type, holder name,
 * school, issue date, copy number and VALID / REVOKED. Never a photo or an id.
 *
 * Never import anything that reads auth state (`useHasPermission`,
 * `getActiveTenant`, `apiClient`) — a stray call throws `NoActiveTenantError`
 * and blanks this page for every visitor.
 */
import { ApiError } from '@biddaloy/ui/api';
import { AuthLayout, Button, Skeleton } from '@biddaloy/ui/components';
import { usePublicVerification } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { CircleCheck, Clock, FileQuestion, RotateCcw, TriangleAlert } from 'lucide-react';

import { GuestStatus } from '../-guest-status';
import { loadRouteNamespaces } from '../../route-loaders';

export const Route = createFileRoute('/v/$token')({
  loader: () => loadRouteNamespaces('verify', 'common'),
  component: VerifyDocumentPage,
});

function VerifyDocumentPage() {
  return (
    <AuthLayout>
      <VerifyBody />
    </AuthLayout>
  );
}

/** Inside `AuthLayout` so `useRegionConfig` sees the visitor's language defaults. */
function VerifyBody() {
  const { t, i18n } = useTranslation('verify');
  const { token } = Route.useParams();
  const query = usePublicVerification(token);

  return (
    <>
      <h1 className="text-h1">{t('pageTitle')}</h1>
      <div className="mt-4">
        {query.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('loading')}
            className="flex flex-col gap-3"
          >
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <VerifiedDocument data={query.data} language={i18n.language} />
        )}
      </div>
      <Link
        to="/"
        className="mt-2 flex h-11 w-full items-center justify-center rounded-md px-3 font-medium text-primary hover:bg-muted"
      >
        {t('home')}
      </Link>
    </>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('verify');
  const status = error instanceof ApiError ? error.statusCode : undefined;

  if (status === 404) {
    return (
      <GuestStatus
        headingLevel="h2"
        icon={FileQuestion}
        tone="warning"
        title={t('notFoundTitle')}
        explanation={t('notFoundExplanation')}
      />
    );
  }
  if (status === 429) {
    return <GuestStatus headingLevel="h2" icon={Clock} tone="warning" title={t('tooMany')} />;
  }
  // Anything else (a dropped connection, a 5xx) is a blip the visitor can retry.
  return (
    <GuestStatus
      headingLevel="h2"
      icon={TriangleAlert}
      tone="danger"
      title={t('errorTitle')}
      explanation={t('errorExplanation')}
    >
      <Button variant="outline" className="w-full" onClick={onRetry}>
        <RotateCcw aria-hidden="true" />
        {t('errorRetry')}
      </Button>
    </GuestStatus>
  );
}

function VerifiedDocument({
  data,
  language,
}: {
  data: NonNullable<ReturnType<typeof usePublicVerification>['data']>;
  language: string;
}) {
  const { t } = useTranslation('verify');
  const region = useRegionConfig();
  const valid = data.status === 'VALID';
  // Bangla first when the page is in Bangla, falling back to the English name.
  const school =
    language.startsWith('bn') && data.school_name_bn ? data.school_name_bn : data.school_name;

  const rows: Array<[string, string]> = [
    [t('rows.type'), t(`kind.${data.document_kind}`, { defaultValue: t('rows.type') })],
    [t('rows.holder'), data.holder_name],
    [t('rows.school'), school],
    [t('rows.issuedOn'), formatDate(data.issued_at, region)],
    [t('rows.copy'), formatNumber(data.copy_number, region)],
  ];
  const StatusIcon = valid ? CircleCheck : TriangleAlert;

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        data-status={data.status}
        className={
          valid
            ? 'flex items-center gap-3 rounded-lg bg-status-paid-bg p-4 text-status-paid-fg'
            : 'flex items-center gap-3 rounded-lg bg-status-overdue-bg p-4 text-status-overdue-fg'
        }
      >
        <StatusIcon aria-hidden="true" className="size-8 shrink-0" />
        <div>
          <p className="text-h3">{valid ? t('valid') : t('revoked')}</p>
          {!valid && data.revoked_at ? (
            <p className="text-body">
              {t('revokedOn', { date: formatDate(data.revoked_at, region) })}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="divide-y divide-border-subtle border-y border-border-subtle">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-3">
            <dt className="text-text-secondary">{label}</dt>
            <dd className="text-end font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-4 text-center text-caption text-text-secondary">{t('footer')}</p>
    </div>
  );
}
