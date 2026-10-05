import { FeeStatus, InvoiceStatus, PaymentStatus } from '@biddaloy/shared';
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PushOptInCard,
  RoutePending,
  Skeleton,
  StatusBadge,
  StudentPicker,
  toast,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import {
  invoicesQueryOptions,
  myStudentsQueryOptions,
  openPrintableInvoice,
  useCurrentUser,
  useFamilyStudentSchedules,
  useFines,
  useMyStudents,
  useStudentFeeSummary,
  useStudentWallet,
  type FamilyStudentSchedule,
  type FamilyStudentWallet,
  type Fine,
  type Invoice,
  type Student,
  type StudentFee,
  type StudentWallet,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTranslation,
  type RegionConfig,
} from '@biddaloy/ui/i18n';
import { dismissPushOptIn, isPushOptInDismissed, usePushSubscription } from '@biddaloy/ui/pwa';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import {
  formatDate,
  formatMonth,
  formatNumber,
  formatServerAmount,
  isPastDueDate,
  parseServerDate,
} from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

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
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `_staff/academic-years/index.tsx`'s
      // identical comment for why.
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common', 'push'),
    ]),
  pendingComponent: PortalFeesPending,
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

/** The server's own `@Max` on `QueryInvoiceDto.limit`. */
const INVOICE_HISTORY_LIMIT = 100;

function PortalFees() {
  const { t } = useTranslation('portal');
  const { t: tNav } = useTranslation('nav');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  // [15.7.6] #557's "first successful portal action" trigger — a guardian
  // viewing this page's invoice history is the first meaningful thing this
  // portal offers, so the one-time opt-in card is offered right after it,
  // not on a separate later action. Dismissal is sticky across visits via
  // `localStorage` (`isPushOptInDismissed`/`dismissPushOptIn`), so this
  // never nags a second time. Read `push.permission`, not just the
  // dismissal flag — no card once the browser can't do push at all, or the
  // guardian already granted/subscribed on this device.
  const push = usePushSubscription();
  const currentUserQuery = useCurrentUser();
  const currentUserId = currentUserQuery.data?.id;
  const [pushOptInDismissed, setPushOptInDismissed] = React.useState(false);
  React.useEffect(() => {
    if (currentUserId) setPushOptInDismissed(isPushOptInDismissed(currentUserId));
  }, [currentUserId]);
  const showPushOptIn =
    !pushOptInDismissed &&
    !!currentUserId &&
    push.permission === 'default' &&
    !push.isSubscribedOnThisDevice;

  function handlePushOptInEnable(): void {
    void push.subscribe();
  }

  function handlePushOptInDismiss(): void {
    if (!currentUserId) return;
    dismissPushOptIn(currentUserId);
    setPushOptInDismissed(true);
  }

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
  const walletQuery = useStudentWallet(selected?.id);
  const schedulesQuery = useFamilyStudentSchedules(selected?.id);
  // [38.4.5] `GET /fees/fines` narrows to the caller's own linked students
  // server-side (`FamilyAccessService`, same as every other query on this
  // page), so `student_id` here is just which child's fines to show, not
  // an access check.
  const finesQuery = useFines(selected === undefined ? {} : { student_id: selected.id }, {
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
      <PageContainer>
        <PageHeader title={tNav('items.portalFees')} />
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
    );
  }

  if (
    summaryQuery.isPending ||
    invoicesQuery.isPending ||
    walletQuery.isPending ||
    schedulesQuery.isPending ||
    finesQuery.isPending
  ) {
    return <FeesSkeleton label={t('fees.loading')} showPicker={students.length > 1} />;
  }

  if (
    summaryQuery.isError ||
    invoicesQuery.isError ||
    walletQuery.isError ||
    schedulesQuery.isError ||
    finesQuery.isError
  ) {
    // One error frame for the whole page, not one per card: every card
    // describes the same student's money, and a half-rendered page would
    // imply the rest is complete. No `<h1>`, and never the server's own
    // message — a raw id must not reach a parent.
    return (
      <ErrorState
        message={t('fees.error.message')}
        retryLabel={t('fees.error.retry')}
        onRetry={() => {
          void summaryQuery.refetch();
          void invoicesQuery.refetch();
          void walletQuery.refetch();
          void schedulesQuery.refetch();
          void finesQuery.refetch();
        }}
      />
    );
  }

  const wallet = walletQuery.data;
  const showWallet = Number(wallet.balance) !== 0 || wallet.transactions.length > 0;
  const showRecurring = schedulesQuery.data.length > 0;

  return (
    <PageContainer>
      <PageHeader
        title={tNav('items.portalFees')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
      />
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
      <div className="grid gap-6 md:grid-cols-3 md:items-start">
        <div className="min-w-0 space-y-6 md:col-span-2">
          <FeesSummary summary={summaryQuery.data} config={config} />
          <BreakdownCard fees={summaryQuery.data.fee_breakdown} config={config} />
          {finesQuery.data.items.length > 0 && (
            <FinesCard fines={finesQuery.data.items} config={config} />
          )}
          <InvoicesCard
            invoices={invoicesQuery.data.data}
            total={invoicesQuery.data.total}
            config={config}
          />
          {showPushOptIn && invoicesQuery.data.data.length > 0 && (
            <PushOptInCard
              onEnable={handlePushOptInEnable}
              onDismiss={handlePushOptInDismiss}
              enabling={push.loading}
            />
          )}
        </div>
        {/* A div, not an aside: the app shell already has one aside landmark. */}
        <div className="space-y-6">
          {showWallet && <WalletCard wallet={wallet} config={config} />}
          {showRecurring && <RecurringFeesCard schedules={schedulesQuery.data} config={config} />}
        </div>
      </div>
    </PageContainer>
  );
}

function FeesSkeleton({ label, showPicker = false }: { label: string; showPicker?: boolean }) {
  return (
    // No `<h1>` while pending — see this file's header table. The
    // `aria-busy` region carries the state for a screen reader instead.
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-8 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      {/* `showPicker` is only true once the student count is known —
          `StudentPicker`'s chips are `min-h-11` plus the nav's `pb-1`, so
          h-12 reserves its real footprint ([8.13.11]). */}
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
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
  const config = useRegionConfig();
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    const roll = formatNumber(student.roll_number, config);
    return className === null
      ? t('children.metaNoClass', { roll })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll,
        });
  };
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
    <Card className="p-4 md:p-5">
      {/* An `<h2>`; the page title above is this frame's `<h1>`. */}
      <h2 className="text-label text-text-secondary">{t('fees.outstanding')}</h2>
      <p className={`mt-1 text-display tabular-nums ${tone}`}>
        {totals.balance > 0 ? formatServerAmount(totals.balance, config) : t('hero.nothingDue')}
      </p>
      {metaParts.length > 0 && (
        <p className="mt-0.5 text-text-secondary">{metaParts.join(' · ')}</p>
      )}
      {/* The arithmetic behind the headline, in reading order. */}
      <dl className="mt-4 grid grid-cols-3 gap-4 border-t border-border-subtle pt-4">
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
function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className="font-semibold tabular-nums">{value ?? '—'}</dd>
    </div>
  );
}

type BreakdownFee = StudentFee & { is_late_fee?: boolean };

function BreakdownCard({ fees, config }: { fees: BreakdownFee[]; config: RegionConfig }) {
  const { t } = useTranslation('portal');
  const now = new Date();

  // The server sends year/month ascending; the newest month is the one a
  // parent came to check, so it leads. A copy, not an in-place sort — the
  // array belongs to the query cache.
  const rows = [...fees].sort((a, b) => b.year - a.year || b.month - a.month);

  const money = (value: number | string) => formatServerAmount(value, config);
  const columns: DataTableColumn<BreakdownFee>[] = [
    {
      id: 'month',
      header: t('fees.month'),
      card: 'title',
      accessorFn: (fee) => (
        <span className="flex flex-col">
          <span className="font-medium">
            {formatMonth(`${fee.year}-${String(fee.month).padStart(2, '0')}`, config)}
            {/* [16.8.4] `is_late_fee` is only set true on bills the school
                raised *because* an earlier bill went unpaid
                (`late_fee_for_student_fee_id IS NOT NULL` server-side) —
                labelled so a parent doesn't mistake it for another
                ordinary month's fee. */}
            {fee.is_late_fee === true && (
              <span className="ml-1.5 text-caption font-normal text-status-overdue-fg">
                {t('fees.lateFeeTag')}
              </span>
            )}
          </span>
          {fee.due_date !== null && (
            <span className="text-caption text-text-secondary">
              {t('hero.dueOn', { date: formatDate(parseServerDate(fee.due_date), config) })}
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'charged',
      header: t('fees.charged'),
      align: 'end',
      accessorFn: (fee) => money(fee.total_amount),
    },
    {
      id: 'discount',
      header: t('fees.discount'),
      align: 'end',
      accessorFn: (fee) => (Number(fee.discount_amount) > 0 ? money(fee.discount_amount) : '—'),
    },
    {
      id: 'paid',
      header: t('fees.paid'),
      align: 'end',
      accessorFn: (fee) => money(fee.paid_amount),
    },
    {
      id: 'outstanding',
      header: t('fees.outstanding'),
      align: 'end',
      accessorFn: (fee) => (
        <span className={`font-semibold ${toneFor(deriveMonthStatus(fee, now))}`}>
          {money(Math.max(balanceOf(fee), 0))}
        </span>
      ),
    },
    {
      id: 'status',
      header: t('fees.status'),
      card: 'badge',
      // The badge is why the amount's colour is never the only carrier of
      // status — it repeats it as text.
      accessorFn: (fee) => <StatusBadge domain="fee" status={deriveMonthStatus(fee, now)} />,
    },
  ];

  return (
    <Card className="overflow-hidden p-0">
      <h2 className="px-4 py-3 text-h2 md:px-5">{t('fees.breakdownTitle')}</h2>
      <DataTable
        tableId="portal-fee-months"
        caption={t('fees.breakdownTitle')}
        columns={columns}
        data={rows}
        getRowId={(fee) => fee.id}
        sorting={null}
        onSortingChange={noop}
        paginated={false}
        totalCount={rows.length}
        emptyState={{ title: t('fees.breakdownTitle'), explanation: t('fees.breakdownEmpty') }}
      />
    </Card>
  );
}

function noop(): void {}

/**
 * [38.4.5] "Fines" section — `GET /fees/fines` filtered to this student,
 * family-scoped server-side. Hidden entirely (not an `EmptyState`) when
 * the child has no fines, per the ticket — a family with no fines should
 * never see an empty "Fines" card telling them so.
 *
 * `fine.status` is read directly here, unlike `deriveMonthStatus`
 * elsewhere on this page: a fine's status (`PENDING`/`PAID`/`WAIVED`) is
 * never silently wrong the way an unpaid month's `OVERDUE` gap is — there
 * is no "carried over fine" concept the way there is a carried-over
 * month, so no derivation is needed.
 */
function FinesCard({ fines, config }: { fines: Fine[]; config: RegionConfig }) {
  const { t } = useTranslation('portal');

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-h2">{t('fees.fines')}</h2>
      <ul className="mt-2 divide-y divide-border-subtle">
        {fines.map((fine) => {
          const hasNote = fine.note !== null && fine.note !== '';
          const incident =
            fine.incident_date !== null
              ? formatDate(parseServerDate(fine.incident_date), config)
              : null;
          return (
            <li key={fine.id} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">{fine.fee_name}</p>
                {(hasNote || incident !== null) && (
                  <p className="text-caption text-text-secondary">
                    {/* Reason stays its own text nodes so an exact match on
                        the reason still finds it. */}
                    {hasNote && (
                      <>
                        {t('fees.reason')}: <span>{fine.note}</span>
                      </>
                    )}
                    {hasNote && incident !== null && ' · '}
                    {incident}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-semibold tabular-nums">
                  {formatServerAmount(fine.total_amount, config)}
                </span>
                <StatusBadge domain="fee" status={fine.status as FeeStatus} />
              </div>
            </li>
          );
        })}
      </ul>
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

  const columns: DataTableColumn<Invoice>[] = [
    {
      id: 'invoice_number',
      header: t('fees.invoiceNumber'),
      card: 'title',
      // An identifier, so Latin digits regardless of tenant numerals (D6).
      accessorFn: (invoice) => <span className="font-medium">{invoice.invoice_number}</span>,
    },
    {
      id: 'issued_date',
      header: t('fees.issuedOn'),
      accessorFn: (invoice) => formatDate(parseServerDate(invoice.issued_date), config),
    },
    {
      id: 'total_amount',
      header: t('fees.amount'),
      align: 'end',
      accessorFn: (invoice) => formatServerAmount(invoice.total_amount, config),
    },
    {
      id: 'status',
      header: t('fees.status'),
      card: 'badge',
      // `schema.d.ts` types this as a string-literal union rather than
      // the shared enum object — the same widening cast
      // `portal/index.tsx` uses for `payment_status`.
      accessorFn: (invoice) => (
        <StatusBadge domain="invoice" status={invoice.status as InvoiceStatus} />
      ),
    },
  ];

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-4 py-3 md:px-5">
        <h2 className="text-h2">{t('fees.invoicesTitle')}</h2>
        <p className="text-text-secondary">{t('fees.newestFirst')}</p>
      </div>
      {truncated && (
        <p className="border-t border-border-subtle px-4 py-2 text-caption text-text-secondary">
          {t('fees.invoicesTruncated', {
            shown: formatNumber(invoices.length, config),
            total: formatNumber(total, config),
          })}
        </p>
      )}
      <DataTable
        tableId="portal-invoices"
        caption={t('fees.invoicesTitle')}
        columns={columns}
        data={invoices}
        getRowId={(invoice) => invoice.id}
        sorting={null}
        onSortingChange={noop}
        paginated={false}
        totalCount={invoices.length}
        emptyState={{ title: t('fees.invoicesTitle'), explanation: t('fees.invoicesEmpty') }}
        // The row itself does not navigate — there is no invoice detail
        // page. Printing is the only affordance.
        rowActions={(invoice) => [
          {
            intent: 'print',
            label: t('fees.print'),
            onClick: () =>
              void openPrintableInvoice(invoice.id, () => toast.error(t('fees.printError'))),
          },
        ]}
      />
    </Card>
  );
}

/**
 * [16.8.4] Wallet balance + short transaction list — `GET
 * /students/:id/wallet`'s family shape (`FamilyStudentWalletResponseDto`,
 * `family.dto.ts`), allow-listed to `{amount, kind, created_at}` per
 * transaction: no `note` (staff free text, withheld same as `Payment.remarks`
 * elsewhere on this page). Kind labels reuse `common.walletTransactionKind.*`
 * — the same keys the staff wallet tab (`fees-tab.tsx`) already renders, so
 * this doesn't duplicate that translation set for a second surface.
 *
 * Only mounted when there is something to show (balance or transactions).
 */
function WalletCard({
  wallet,
  config,
}: {
  // `useStudentWallet` is shared with the staff wallet tab, so it's typed
  // as the role union (`StudentWallet | FamilyStudentWallet`) — this card
  // is only ever mounted in the family portal, but stays honest about
  // that by reading nothing beyond the fields both shapes share
  // (`balance`, and `amount`/`kind`/`created_at` per transaction), never
  // the staff-only `note`.
  wallet: StudentWallet | FamilyStudentWallet;
  config: RegionConfig;
}) {
  const { t } = useTranslation('portal');
  const { t: tCommon } = useTranslation('common');
  // Newest few only — this is a glance-at card, not a ledger.
  const recent = wallet.transactions.slice(0, 5);

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-h2">{t('fees.walletTitle')}</h2>
      <p className="mt-2 text-caption text-text-secondary">{t('fees.walletBalance')}</p>
      <p className="text-h2 tabular-nums">{formatServerAmount(wallet.balance, config)}</p>
      {recent.length === 0 ? (
        <p className="mt-3 text-text-secondary">{t('fees.walletEmpty')}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border-subtle border-t border-border-subtle">
          {recent.map((tx, index) => (
            <li
              key={`${tx.created_at}-${index}`}
              className="flex items-center justify-between gap-3 py-3"
            >
              <div className="flex min-w-0 flex-col">
                <span>
                  {tCommon(`walletTransactionKind.${tx.kind}`, { defaultValue: tx.kind })}
                </span>
                <span className="text-caption text-text-secondary">
                  {formatDate(tx.created_at, config)}
                </span>
              </div>
              <span className="font-semibold tabular-nums">
                {formatServerAmount(tx.amount, config)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * [16.8.4] "Recurring fees" — `GET /students/:id/schedules`'s family
 * shape (`FamilyStudentScheduleDto[]`, `family.dto.ts`): human labels
 * only (`name`, `fees`, `rule_label`, `next_period`). No schedule `id`,
 * `audience`, `excluded` or `is_active` — none of that is family's
 * business, and `useFamilyStudentSchedules` never requests it. Only
 * mounted when the child has at least one schedule.
 */
function RecurringFeesCard({
  schedules,
  config,
}: {
  schedules: FamilyStudentSchedule[];
  config: RegionConfig;
}) {
  const { t } = useTranslation('portal');

  return (
    <Card className="p-4 md:p-5">
      <h2 className="text-h2">{t('fees.recurringTitle')}</h2>
      <ul className="mt-2 divide-y divide-border-subtle">
        {schedules.map((schedule, index) => (
          <li key={`${schedule.name}-${index}`} className="space-y-0.5 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium">{schedule.name}</span>
              <span className="font-semibold tabular-nums">
                {formatServerAmount(
                  schedule.fees.reduce((sum, fee) => sum + fee.amount, 0),
                  config,
                )}
              </span>
            </div>
            <p className="text-caption text-text-secondary">{schedule.rule_label}</p>
            {schedule.next_period !== null && (
              <p className="text-caption text-text-secondary">
                {t('fees.recurringNextOn', {
                  date: formatDate(parseServerDate(schedule.next_period), config),
                })}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PortalFeesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}
