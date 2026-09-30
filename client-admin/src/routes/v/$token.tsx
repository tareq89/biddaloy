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
import { Skeleton } from '@biddaloy/ui/components';
import { usePublicVerification } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../route-loaders';

export const Route = createFileRoute('/v/$token')({
  loader: () => loadRouteNamespaces('verify', 'common'),
  component: VerifyDocumentPage,
});

/** Decorative, `aria-hidden` — the status is always also said in words. */
function StatusIcon({ valid }: { valid: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-10">
      <circle cx="10" cy="10" r="8.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d={valid ? 'm6.5 10.5 2.5 2.5 4.5-5' : 'm7 7 6 6m0-6-6 6'}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A dashed, centred message card for the "nothing to show" states. */
function MessageCard({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div
      role="status"
      data-slot="route-status-state"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-subtle bg-card p-8 text-center"
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function VerifyDocumentPage() {
  const { t, i18n } = useTranslation('verify');
  const { token } = Route.useParams();
  const query = usePublicVerification(token);
  const region = useRegionConfig();

  // The shared formatter renders digits per locale (Bangla numerals in bn).
  const formatIso = (iso: string) => formatDate(new Date(iso), region);

  return (
    <div className="flex min-h-screen flex-col items-center gap-4 bg-background p-4 sm:p-6">
      <h1 className="sr-only">{t('pageTitle')}</h1>
      <div className="w-full max-w-[420px] sm:max-w-[520px]">
        {query.isPending ? (
          <div role="status" aria-label={t('loading')} className="flex flex-col gap-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <VerifiedDocument data={query.data} formatDate={formatIso} language={i18n.language} />
        )}
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation('verify');
  const status = error instanceof ApiError ? error.statusCode : undefined;

  if (status === 404) {
    return (
      <MessageCard title={t('notFoundTitle')}>
        <p className="text-sm text-muted-foreground">{t('notFoundExplanation')}</p>
      </MessageCard>
    );
  }
  if (status === 429) {
    return <MessageCard title={t('tooMany')} />;
  }
  // Anything else (a dropped connection, a 5xx) is a blip the visitor can retry.
  return (
    <MessageCard title={t('errorTitle')}>
      <p className="text-sm text-muted-foreground">{t('errorExplanation')}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 text-sm font-medium text-primary underline underline-offset-4"
      >
        {t('errorRetry')}
      </button>
    </MessageCard>
  );
}

function VerifiedDocument({
  data,
  formatDate,
  language,
}: {
  data: NonNullable<ReturnType<typeof usePublicVerification>['data']>;
  formatDate: (iso: string) => string;
  language: string;
}) {
  const { t } = useTranslation('verify');
  const valid = data.status === 'VALID';
  // Bangla first when the page is in Bangla, falling back to the English name.
  const school =
    language.startsWith('bn') && data.school_name_bn ? data.school_name_bn : data.school_name;

  const rows: Array<[string, string]> = [
    [t('rows.type'), t(`kind.${data.document_kind}`, { defaultValue: data.document_kind })],
    [t('rows.holder'), data.holder_name],
    [t('rows.school'), school],
    [t('rows.issuedOn'), formatDate(data.issued_at)],
    [t('rows.copy'), String(data.copy_number)],
  ];

  return (
    <div className="flex flex-col gap-4">
      <div
        role="status"
        data-status={data.status}
        className={
          valid
            ? 'flex items-center gap-3 rounded-lg bg-status-paid-bg p-5 text-status-paid-fg'
            : 'flex items-center gap-3 rounded-lg bg-status-overdue-bg p-5 text-status-overdue-fg'
        }
      >
        <StatusIcon valid={valid} />
        <div>
          <p className="text-xl font-semibold">{valid ? t('valid') : t('revoked')}</p>
          {!valid && data.revoked_at ? (
            <p className="text-sm">{t('revokedOn', { date: formatDate(data.revoked_at) })}</p>
          ) : null}
        </div>
      </div>

      <dl className="divide-y divide-border-subtle rounded-lg border border-border-subtle bg-card">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-4 py-3 text-sm">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-center text-xs text-muted-foreground">{t('footer')}</p>
    </div>
  );
}
