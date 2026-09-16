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
import { InvoiceReceipt, Skeleton } from '@biddaloy/ui/components';
import { usePublicInvoice } from '@biddaloy/ui/hooks';
import { REGION_BD_EN, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../route-loaders';

export const Route = createFileRoute('/i/$token')({
  loader: () => loadRouteNamespaces('fees', 'common'),
  component: PublicReceiptPage,
});

/** Decorative, `aria-hidden` — a plain document glyph. */
function ReceiptIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-8">
      <path
        d="M5 3h10v14l-2.5-1.5L10 17l-2.5-1.5L5 17V3Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M7.5 7h5M7.5 10h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function PublicReceiptPage() {
  const { t } = useTranslation('fees');
  const { token } = Route.useParams();
  const receiptQuery = usePublicInvoice(token);

  return (
    <div className="flex min-h-screen flex-col items-center gap-4 bg-background p-4 sm:p-6">
      <h1 className="sr-only">{t('invoiceDetail.publicReceipt.pageTitle')}</h1>
      <div className="w-full max-w-[420px] sm:max-w-[640px]">
        {receiptQuery.isPending ? (
          <div
            role="status"
            aria-label={t('invoiceDetail.publicReceipt.loading')}
            className="flex flex-col gap-3"
          >
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : receiptQuery.isError ? (
          <div
            role="status"
            data-slot="route-status-state"
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border-subtle bg-card p-8 text-center"
          >
            <div aria-hidden="true" className="text-muted-foreground">
              <ReceiptIcon />
            </div>
            <h2 className="text-lg font-semibold">
              {t('invoiceDetail.publicReceipt.notFoundTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('invoiceDetail.publicReceipt.notFoundExplanation')}
            </p>
          </div>
        ) : (
          <>
            <InvoiceReceipt
              receipt={receiptQuery.data}
              width="a4"
              config={REGION_BD_EN}
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
            <button
              type="button"
              className="mt-4 w-full rounded-md border border-border bg-card px-4 py-2 text-sm font-medium print:hidden"
              onClick={() => window.print()}
            >
              {t('invoiceDetail.publicReceipt.saveAsPdf')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
