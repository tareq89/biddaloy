/**
 * [16.5.5] The public receipt page a guardian opens from a WhatsApp/SMS
 * share link — `/i/<share-token>`, no login, no session, no `apiClient`
 * call of any kind. `usePublicInvoice` hits `GET /public/invoices/:token`
 * (#666) with bare `axios`, deliberately bypassing `apiClient`'s request
 * interceptor: that interceptor throws `NoActiveTenantError` when no
 * tenant is active (`ui/src/api/client.ts:56-66`), and a phone reading
 * this link cold never has one. See that hook's own header comment.
 *
 * `__root.tsx`'s auth guard short-circuits for every `/i/` path before
 * `ensureSessionLoaded()` runs (its own `PUBLIC_PATH_PREFIXES` comment
 * explains why: a cold-boot `POST /auth/refresh` for a visitor with no
 * session at all would be pure waste, and AC explicitly says "no auth
 * calls"). This route is chrome-free by construction, same as
 * `login.tsx`/`verify-email.tsx` — no `AppShell`, since that lives one
 * level down in the audience layouts (`_staff.tsx`/`portal.tsx`), which
 * this route sits entirely outside of.
 *
 * Never import anything that reads auth state (`useHasPermission`,
 * `getActiveTenant`, `apiClient`) — a single stray call throws
 * `NoActiveTenantError` and blanks this page for every visitor.
 */
import { ApiError } from '@biddaloy/ui/api';
import { AuthLayout, Button, InvoiceReceipt, Skeleton } from '@biddaloy/ui/components';
import { usePublicInvoice } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Download, FileQuestion, RotateCcw, TriangleAlert } from 'lucide-react';

import { GuestStatus } from '../-guest-status';
import { loadRouteNamespaces } from '../../route-loaders';

import { toDisplayReceipt } from './-receipt-display';

export const Route = createFileRoute('/i/$token')({
  loader: () => loadRouteNamespaces('fees', 'payments', 'verify', 'common'),
  component: PublicReceiptPage,
});

/** A 404 (unknown token) or 410 (revoked token) is the server's explicit
 * "this link will never work" answer — anything else (a dropped
 * connection, a 5xx, a timeout) is a transient failure a guardian
 * should be able to retry, not told their receipt link is invalid. */
function isUnknownOrRevokedToken(error: unknown): boolean {
  return error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 410);
}

function PublicReceiptPage() {
  return (
    <AuthLayout>
      <ReceiptBody />
    </AuthLayout>
  );
}

/** Inside `AuthLayout` so `useRegionConfig` sees the visitor's language defaults. */
function ReceiptBody() {
  const { t } = useTranslation('fees');
  const { token } = Route.useParams();
  const receiptQuery = usePublicInvoice(token);
  const region = useRegionConfig();

  return (
    <>
      <h1 className="text-h1">{t('invoiceDetail.publicReceipt.pageTitle')}</h1>
      <div className="mt-4">
        {receiptQuery.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('invoiceDetail.publicReceipt.loading')}
            className="flex flex-col gap-3"
          >
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : receiptQuery.isError && isUnknownOrRevokedToken(receiptQuery.error) ? (
          <GuestStatus
            headingLevel="h2"
            icon={FileQuestion}
            tone="warning"
            title={t('invoiceDetail.publicReceipt.notFoundTitle')}
            explanation={t('invoiceDetail.publicReceipt.notFoundExplanation')}
          />
        ) : receiptQuery.isError ? (
          <GuestStatus
            headingLevel="h2"
            icon={TriangleAlert}
            tone="danger"
            title={t('invoiceDetail.publicReceipt.errorTitle')}
            explanation={t('invoiceDetail.publicReceipt.errorExplanation')}
          >
            <Button
              variant="outline"
              className="w-full"
              onClick={() => void receiptQuery.refetch()}
            >
              <RotateCcw aria-hidden="true" />
              {t('invoiceDetail.publicReceipt.errorRetry')}
            </Button>
          </GuestStatus>
        ) : (
          <>
            <InvoiceReceipt
              receipt={toDisplayReceipt(receiptQuery.data, region, (method) =>
                t(`record.method.methods.${method}`, { ns: 'payments', defaultValue: '—' }),
              )}
              width="a4"
              config={region}
              labels={{
                creditNote: t('invoiceDetail.publicReceipt.creditNote'),
                issuedDate: t('invoiceDetail.issuedDate'),
                billed: t('invoiceDetail.publicReceipt.billed'),
                discount: t('invoiceDetail.discountAmount'),
                paid: t('invoiceDetail.publicReceipt.paid'),
                change: t('invoiceDetail.publicReceipt.change'),
                paymentMethod: t('invoiceDetail.publicReceipt.paymentMethod'),
                paymentDate: t('invoiceDetail.publicReceipt.paymentDate'),
              }}
            />
            <Button className="mt-5 w-full print:hidden" onClick={() => window.print()}>
              <Download aria-hidden="true" />
              {t('invoiceDetail.publicReceipt.saveAsPdf')}
            </Button>
          </>
        )}
      </div>
      <Link
        to="/"
        className="mt-2 flex h-11 w-full items-center justify-center rounded-md px-3 font-medium text-primary hover:bg-muted print:hidden"
      >
        {t('home', { ns: 'verify' })}
      </Link>
    </>
  );
}
