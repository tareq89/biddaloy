import { FeeStatus, InvoiceStatus, PaymentStatus } from '@biddaloy/shared';
import {
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  StatusBadge,
  StudentPicker,
  toast,
} from '@biddaloy/ui/components';
import {
  invoicesQueryOptions,
  openPrintableInvoice,
  useMyStudents,
  useStudentFeeSummary,
  type Invoice,
  type Student,
  type StudentFee,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTranslation,
  type RegionConfig,
} from '@biddaloy/ui/i18n';
import {
  formatDate,
  formatServerAmount,
  isPastDueDate,
  parseServerDate,
  renderDigits,
} from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';
import { z } from 'zod';

/**
 * [5.3] — the fee breakdown and invoice history behind [5.2]'s landing.
 * A parent or student picks one child and sees, for that child: what the
 * school charged month by month, what was discounted, what was paid, what
 * is still outstanding — and the invoices behind those months, newest
 * first, each printable.
 *
 * **Frontend-only ticket.** Every "server work with no ticket yet" item in
 * #21's body was already shipped by [5.1]: `GET /fees/dues`,
 * `/fee-structures`, `/invoices`, `/invoices/:id`,
 * `/payments/invoices/student/:studentId` and `/invoices/:id/print` all
 * allow PARENT/STUDENT and narrow to the caller's linked students through
 * `FamilyAccessService`. The "a parent cannot reach an unlinked student"
 * criterion is enforced and tested *there* — this page never depends on
 * hiding a link for it, which is why `?student=` is allowed to name any
 * id at all (an unlinked one simply 403s into the error frame).
 *
 * Built to the approved `templates/portal-fees` mockup, with the
 * decisions that mockup carries:
 *
 * - **No table.** The four figures per month are a headline outstanding
 *   plus a three-up charged/discount/paid grid. A 4-column table is
 *   unreadable at the 320px the AC requires.
 * - **Paid months stay in the list**, reading ৳0 outstanding. A parent
 *   checking *what was charged* needs them. This is the reason the data
 *   comes from `useStudentFeeSummary` (`GET
 *   /payments/invoices/student/:id`, every `StudentFee` row) and **not**
 *   from `useFeeDues`, which only ever returns PENDING/PARTIALLY_PAID
 *   months and would silently drop every settled one.
 * - **Print is a per-invoice icon button**, not a row link: the row
 *   itself navigates nowhere, because there is no invoice detail page in
 *   this ticket — only the existing server-rendered printable view.
 * - **The picker is a row of links reflecting `?student=`**, so a chosen
 *   child is bookmarkable and the back button works. It renders only when
 *   the caller can see more than one student — same "no redundant
 *   single-item list" rule as `portal/index.tsx`.
 * - **Zero discount renders as an em dash**, not "৳0.00", so a real zero
 *   is not read as a missing figure.
 * - **Read-only.** No mutation of any kind lives on this page, so
 *   `no-optimistic-financial-mutation` is satisfied by construction, and
 *   there is no "pay now" anywhere — self-service payment is #291.
 *
 * **Heading structure is load-bearing.** `useRouteFocus` focuses the
 * route's `<h1>` inside `<main>` after a navigation, so, per frame:
 *
 * | Frame          | `<h1>`                                     |
 * | -------------- | ------------------------------------------ |
 * | Settled        | the page title ("Fees")                    |
 * | No students    | `EmptyState`'s own `title` (nothing else)  |
 * | Loading        | none — focus falls back to `<main>`        |
 * | Error          | none — focus falls back to `<main>`        |
 *
 * The mockup's error frame drew the page header above the error; it is
 * dropped here so the "zero `<h1>` while erroring" contract
 * `portal/index.tsx` documents holds on this route too. For the same
 * reason the "no invoices yet" and "no fees yet" states are plain
 * paragraphs rather than `EmptyState`s — `EmptyState`'s title *is* an
 * `<h1>`, and this frame already has one.
 *
 * Region config comes from a **value-less** `RegionConfigProvider`, not
 * `useTenantRegionConfig()`: that hook reads `GET /schools/:id/settings`,
 * which is ADMIN-only, so a PARENT would 403 on every page load for a
 * value it would fall back from anyway. Identical reasoning to
 * `portal/index.tsx` and `login.tsx`.
 */
const feesSearchSchema = z.object({
  /** Which linked student to show. Not trusted to *widen* anything — the
   * server re-checks the link on every request — and an id that is not in
   * the caller's own `/students/mine` list falls back to the first
   * student rather than being forwarded. */
  student: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/fees')({
  validateSearch: feesSearchSchema,
  component: PortalFeesRoute,
});

function PortalFeesRoute() {
  return (
    <RegionConfigProvider>
      <PortalFees />
    </RegionConfigProvider>
  );
}

/** `StudentFee.balance` is not a column — the server sends the three
 * component figures and the balance is their arithmetic. Kept in one
 * place so the month row and the summary can never disagree about it. */
function balanceOf(fee: StudentFee): number {
  return Number(fee.total_amount) - Number(fee.paid_amount) - Number(fee.discount_amount);
}

/**
 * **Never trust `fee.status` to say "overdue".** Nothing server-side ever
 * writes `OVERDUE` into `student_fees` — the only mention of it there is a
 * read filter — so a page that rendered `fee.status` verbatim would show a
 * parent six months late a neutral "Pending" badge. This is the same
 * derivation `portal/index.tsx`'s `deriveStatus` and the staff dues
 * queue's `deriveRowStatus` use, applied per month.
 */
function deriveMonthStatus(fee: StudentFee, now: Date): FeeStatus {
  if (balanceOf(fee) <= 0) return fee.status as FeeStatus;
  if (isPastDueDate(fee.due_date, now)) {
    return FeeStatus.OVERDUE;
  }
  return fee.status as FeeStatus;
}

function toneFor(status: FeeStatus): string {
  if (status === FeeStatus.OVERDUE) return 'text-status-overdue-fg';
  if (status === FeeStatus.PAID) return 'text-status-paid-fg';
  return 'text-status-due-fg';
}

/**
 * Month names through twelve **literal** `t()` calls rather than a
 * computed `t(\`months.${n}\`)`: a computed key is invisible to
 * `check-i18n-keys.mjs`, so a month whose translation was never added
 * would ship as a raw key to a parent instead of failing the build. Same
 * reasoning `portal/index.tsx`'s `usePaymentMethodLabel` documents.
 */
function useMonthNames(): string[] {
  const { t } = useTranslation('portal');
  return [
    t('fees.months.1'),
    t('fees.months.2'),
    t('fees.months.3'),
    t('fees.months.4'),
    t('fees.months.5'),
    t('fees.months.6'),
    t('fees.months.7'),
    t('fees.months.8'),
    t('fees.months.9'),
    t('fees.months.10'),
    t('fees.months.11'),
    t('fees.months.12'),
  ];
}

/** The server's own `@Max` on `QueryInvoiceDto.limit`. */
const INVOICE_HISTORY_LIMIT = 100;

function PortalFees() {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  // The param names a student only if the caller can actually see them.
  // Otherwise the first student, which is what the landing page links to.
  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const summaryQuery = useStudentFeeSummary(selected?.id);
  // `GET /invoices` defaults to 10 per page, and a monthly fee schedule
  // issues twelve invoices a year — so the default silently hides part of
  // the first year and more of every year after. 100 is the server's own
  // `@Max` on `limit` (`QueryInvoiceDto`), which covers a full school
  // career of monthly invoicing in one request; `InvoicesCard` says so
  // out loud on the arithmetically-possible day it isn't enough, rather
  // than truncating in silence. There is no unpaginated alternative:
  // `/payments/invoices/student/:id` carries fees and payments, not
  // invoices.
  // `invoicesQueryOptions` composed by hand rather than `useInvoices`,
  // purely for the `enabled` guard: `useInvoices` has no way to stay
  // parked, and while `/students/mine` is still in flight there is no
  // student id yet — an unguarded call would fire a *filterless*
  // `GET /invoices`, which is the tenant-wide staff list, and cache it
  // under the `invoiceKeys.list({})` key staff surfaces share.
  const invoicesQuery = useQuery({
    ...invoicesQueryOptions(
      selected === undefined ? {} : { student_id: selected.id, limit: INVOICE_HISTORY_LIMIT },
    ),
    enabled: selected !== undefined,
  });

  if (studentsQuery.isPending) return <FeesSkeleton label={t('fees.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('fees.error.message')}
        retryLabel={t('fees.error.retry')}
        onRetry={() => void studentsQuery.refetch()}
      />
    );
  }

  if (students.length === 0 || selected === undefined) {
    // Not an error: an unlinked account is a real state only the school
    // office can resolve, so the copy names that fix.
    return (
      <EmptyState
        title={t('empty.title')}
        explanation={t('empty.explanation')}
        action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
      />
    );
  }

  if (summaryQuery.isPending || invoicesQuery.isPending) {
    return <FeesSkeleton label={t('fees.loading')} />;
  }

  if (summaryQuery.isError || invoicesQuery.isError) {
    // One error frame for the whole page, not one per card: both halves
    // describe the same student's money, and a half-rendered page would
    // imply the other half is complete. No `<h1>`, and never the server's
    // own message — a raw id must not reach a parent.
    return (
      <ErrorState
        message={t('fees.error.message')}
        retryLabel={t('fees.error.retry')}
        onRetry={() => {
          void summaryQuery.refetch();
          void invoicesQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <FeesHeader student={selected} />
      {/* Only when there is a real choice to make. `StudentPicker` holds
          the same rule itself (it renders nothing below two items), so a
          guardian of one child sees no switching UI either way. */}
      {students.length > 1 && (
        <StudentPicker
          label={t('fees.pickerLabel')}
          items={students.map((student) => ({
            id: student.id,
            name: student.full_name,
            meta: studentMeta(student),
          }))}
          selectedId={selected.id}
          to="/portal/fees"
        />
      )}
      <FeesSummary summary={summaryQuery.data} config={config} />
      <BreakdownCard fees={summaryQuery.data.fee_breakdown} config={config} />
      <InvoicesCard
        invoices={invoicesQuery.data.data}
        total={invoicesQuery.data.total}
        config={config}
      />
    </div>
  );
}

function FeesSkeleton({ label }: { label: string }) {
  return (
    // No `<h1>` while pending — see this file's header table. The
    // `aria-busy` region carries the state for a screen reader instead.
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-5 w-2/5" />
      <Skeleton className="h-32 w-full rounded-lg" />
      <Skeleton className="h-44 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}

/** The same "class section · roll" line `portal/index.tsx` renders, from
 * the same two keys — a second wording for the same fact would drift. */
function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    return className === null
      ? t('children.metaNoClass', { roll: student.roll_number })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll: student.roll_number,
        });
  };
}

function FeesHeader({ student }: { student: Student }) {
  const { t } = useTranslation('portal');
  const studentMeta = useStudentMeta();
  return (
    <div className="flex flex-col gap-0.5">
      {/* This route's one `<h1>`. The student's name is the subtitle, not
          the heading, because the picker can change it without the page
          changing what it is. */}
      <h1 className="text-lg font-semibold tracking-tight">{t('fees.title')}</h1>
      <p className="text-xs text-muted-foreground">
        {`${student.full_name} · ${studentMeta(student)}`}
      </p>
    </div>
  );
}

/** `schema.d.ts` types `payment_status` as a string-literal union rather
 * than the shared enum object — same widening `portal/index.tsx` uses. */
type PaymentStatusValue = `${PaymentStatus}`;
const RECEIVED_STATUS: PaymentStatusValue = PaymentStatus.SUCCESS;

function FeesSummary({
  summary,
  config,
}: {
  summary: NonNullable<ReturnType<typeof useStudentFeeSummary>['data']>;
  config: RegionConfig;
}) {
  const { t } = useTranslation('portal');
  const totals = summary.summary;
  const now = new Date();

  // The overdue *portion* — the sum of the balances whose due date has
  // already passed — not the whole outstanding balance. Rolling the two
  // together would tell a parent with one late month and four future ones
  // that all five are late.
  const overdue = summary.fee_breakdown
    .filter((fee) => balanceOf(fee) > 0 && isPastDueDate(fee.due_date, now))
    .reduce((sum, fee) => sum + balanceOf(fee), 0);

  const metaParts: string[] = [];
  if (overdue > 0) {
    metaParts.push(t('hero.overdueAmount', { amount: formatServerAmount(overdue, config) }));
  } else {
    // Only a *received* payment can date this line — a bounced cheque
    // recorded last week must not read as "Last paid last week".
    const lastPaid = summary.payments.find((payment) => payment.payment_status === RECEIVED_STATUS);
    if (lastPaid !== undefined) {
      metaParts.push(
        t('hero.lastPaid', { date: formatDate(parseServerDate(lastPaid.payment_date), config) }),
      );
    }
  }

  const tone = toneFor(
    overdue > 0 ? FeeStatus.OVERDUE : totals.balance > 0 ? FeeStatus.PENDING : FeeStatus.PAID,
  );

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-col gap-0.5">
        {/* An `<h2>`; the page title above is this frame's `<h1>`. */}
        <h2 className="text-sm font-normal text-muted-foreground">{t('fees.outstanding')}</h2>
        <div className={`text-3xl leading-tight font-bold tabular-nums ${tone}`}>
          {totals.balance > 0 ? formatServerAmount(totals.balance, config) : t('hero.nothingDue')}
        </div>
        {metaParts.length > 0 && (
          <div className="text-xs text-muted-foreground">{metaParts.join(' · ')}</div>
        )}
      </div>
      {/* The arithmetic behind the headline, in reading order. */}
      <dl className="grid grid-cols-3 gap-2 border-t border-border pt-3">
        <Figure label={t('fees.charged')} value={formatServerAmount(totals.total_due, config)} />
        <Figure
          label={t('fees.discount')}
          value={
            totals.total_discount > 0 ? formatServerAmount(totals.total_discount, config) : null
          }
        />
        <Figure label={t('fees.paid')} value={formatServerAmount(totals.total_paid, config)} />
      </dl>
    </Card>
  );
}

/** `value === null` means "no discount", rendered as an em dash rather
 * than ৳0.00 so a real zero is never mistaken for a missing figure. */
function Figure({ label, value, small }: { label: string; value: string | null; small?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt
        className={
          small
            ? 'text-[10.5px] tracking-wide text-muted-foreground uppercase'
            : 'text-[11px] text-muted-foreground'
        }
      >
        {label}
      </dt>
      <dd className={`tabular-nums ${small ? 'text-xs' : 'text-sm font-semibold'}`}>
        {value ?? '—'}
      </dd>
    </div>
  );
}

function BreakdownCard({ fees, config }: { fees: StudentFee[]; config: RegionConfig }) {
  const { t } = useTranslation('portal');
  const monthNames = useMonthNames();
  const now = new Date();

  // The server sends year/month ascending; the newest month is the one a
  // parent came to check, so it leads. A copy, not an in-place sort — the
  // array belongs to the query cache.
  const rows = [...fees].sort((a, b) => b.year - a.year || b.month - a.month);

  return (
    <Card className="flex flex-col">
      <h2 className="border-b border-border px-3.5 py-3 text-sm font-semibold">
        {t('fees.breakdownTitle')}
      </h2>
      {rows.length === 0 ? (
        // Deliberately not `EmptyState`: its title renders an `<h1>`, and
        // this frame's `<h1>` is the page title.
        <p className="p-3.5 text-sm text-muted-foreground">{t('fees.breakdownEmpty')}</p>
      ) : (
        rows.map((fee, index) => {
          const status = deriveMonthStatus(fee, now);
          const balance = balanceOf(fee);
          return (
            <div
              key={fee.id}
              className={`flex flex-col gap-1.5 px-3.5 py-3 ${
                index > 0 ? 'border-t border-border' : ''
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">
                  {t('fees.monthLabel', {
                    month: monthNames[fee.month - 1] ?? String(fee.month),
                    // Bengali numerals when the region asks for them —
                    // the same treatment every other figure on the page
                    // gets, so a year isn't the one Latin number left.
                    year: renderDigits(String(fee.year), config.numerals),
                  })}
                </span>
                <span className={`text-base font-bold tabular-nums ${toneFor(status)}`}>
                  {formatServerAmount(Math.max(balance, 0), config)}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-1.5">
                <Figure
                  small
                  label={t('fees.charged')}
                  value={formatServerAmount(fee.total_amount, config)}
                />
                <Figure
                  small
                  label={t('fees.discount')}
                  value={
                    Number(fee.discount_amount) > 0
                      ? formatServerAmount(fee.discount_amount, config)
                      : null
                  }
                />
                <Figure
                  small
                  label={t('fees.paid')}
                  value={formatServerAmount(fee.paid_amount, config)}
                />
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* The badge is why the amount's colour is never the only
                    carrier of status — it repeats it as text. */}
                <StatusBadge domain="fee" status={status} />
                {fee.due_date !== null && (
                  <span className="text-[11px] text-muted-foreground">
                    {t('hero.dueOn', { date: formatDate(parseServerDate(fee.due_date), config) })}
                  </span>
                )}
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}

/**
 * Invoice rows in the order the server delivered them — `issued_date DESC`
 * (`invoices.service.ts`), i.e. newest first. Nothing re-sorts here.
 *
 * Only fields `FamilyInvoiceDto` actually guarantees are read. In
 * particular `issued_by` is pinned `null` for a family caller by design,
 * so nothing on this row may depend on it.
 */
function InvoicesCard({
  invoices,
  total,
  config,
}: {
  invoices: Invoice[];
  total: number;
  config: RegionConfig;
}) {
  const { t } = useTranslation('portal');
  // Only reachable once a student has more than INVOICE_HISTORY_LIMIT
  // invoices. Saying "showing the most recent 100 of 112" is the one
  // thing that must not be left unsaid: a parent counting a missing
  // month would otherwise conclude the school never issued it.
  const truncated = total > invoices.length;

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3.5 py-3">
        <h2 className="text-sm font-semibold">{t('fees.invoicesTitle')}</h2>
        <span className="text-[11px] text-muted-foreground">{t('fees.newestFirst')}</span>
      </div>
      {truncated && (
        <p className="border-b border-border px-3.5 py-2 text-[11px] text-muted-foreground">
          {t('fees.invoicesTruncated', {
            shown: renderDigits(String(invoices.length), config.numerals),
            total: renderDigits(String(total), config.numerals),
          })}
        </p>
      )}
      {invoices.length === 0 ? (
        <p className="p-3.5 text-sm text-muted-foreground">{t('fees.invoicesEmpty')}</p>
      ) : (
        invoices.map((invoice, index) => (
          <div
            key={invoice.id}
            className={`flex items-center gap-2.5 px-3.5 py-2.5 ${
              index > 0 ? 'border-t border-border' : ''
            }`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm font-semibold tabular-nums">{invoice.invoice_number}</span>
              <span className="text-[11px] text-muted-foreground">
                {formatDate(parseServerDate(invoice.issued_date), config)}
              </span>
            </div>
            <div className="flex flex-shrink-0 flex-col items-end gap-1">
              <span className="text-sm font-semibold tabular-nums">
                {formatServerAmount(invoice.total_amount, config)}
              </span>
              {/* `schema.d.ts` types this as a string-literal union rather than
                  the shared enum object — the same widening cast
                  `portal/index.tsx` uses for `payment_status`. */}
              <StatusBadge domain="invoice" status={invoice.status as InvoiceStatus} />
            </div>
            {/* The row itself does not navigate — there is no invoice
                detail page in this ticket. Printing is the only
                affordance, so it is an explicit button with a >=44px
                target and a label naming which invoice it prints. */}
            <button
              type="button"
              aria-label={t('fees.printLabel', { number: invoice.invoice_number })}
              onClick={() =>
                void openPrintableInvoice(invoice.id, () => toast.error(t('fees.printError')))
              }
              className="flex size-11 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground"
            >
              <PrinterIcon className="size-4.5" aria-hidden="true" />
            </button>
          </div>
        ))
      )}
    </Card>
  );
}
