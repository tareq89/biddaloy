import { FeeStatus, PaymentStatus } from '@biddaloy/shared';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useFeeDues,
  useMyStudents,
  usePaymentsByStudent,
} from '@biddaloy/ui/hooks';
import type { FeeDueRow, Student } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTranslation,
  type RegionConfig,
} from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount, isPastDueDate, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';

import { loadRouteNamespaces } from '../../route-loaders';

/**
 * [5.2] — the family portal's landing page, replacing [8.9.10]'s
 * placeholder. A parent sees every child they're linked to with per-child
 * fee status and one across-children total; a student (or a parent of
 * exactly one child) sees that one record with its recent payments.
 *
 * Built to the approved `templates/portal-landing` mockup, with the
 * decisions that mockup carries:
 *
 * - The hero total counts **only children who owe something** and says so
 *   ("Across 2 of 3 children"), rather than silently folding the paid-up
 *   child into a number that then can't be reconciled with the cards.
 * - A paid-up child still gets a card, reading "Nothing due". Dropping it
 *   would read as a missing child, which is a worse bug than a redundant
 *   row.
 * - **Exactly one visible student ⇒ no list at all.** The student is
 *   promoted into the page header and recent payments fill the freed
 *   space. This branch keys off how many students the caller can see, not
 *   off their role: a parent of one child and a student looking at their
 *   own record want the identical page.
 * - No "pay now" anywhere — self-service payment is #291 and has no
 *   backend behind it yet.
 * - Each child card **is** a link, into that child's fee view
 *   (`/portal/fees?student=<id>`) — the mockup's per-child drill-down,
 *   built in [5.3] and wired up here in [5.5]. The whole card is the one
 *   tap target (`Card asChild` merging onto a `Link`), so it stays a
 *   single ≥44px hit area and holds no nested interactive child.
 *
 * **Heading structure is load-bearing, not cosmetic.** `useRouteFocus`
 * (`ui/src/hooks/use-route-focus.ts`) finds a route's heading with
 * `querySelector('h1')` inside the `<main>` landmark and focuses it after
 * a navigation, falling back to the landmark itself when there is none.
 * So, per frame:
 *
 * | Frame            | `<h1>`                                   |
 * | ---------------- | ---------------------------------------- |
 * | Several children | the hero's "Total outstanding" label      |
 * | One student      | the student's `full_name`                 |
 * | No students      | `EmptyState`'s own `title` (nothing else) |
 * | Loading          | none — focus falls back to `<main>`       |
 * | Error            | none — focus falls back to `<main>`       |
 *
 * Loading and error rendering zero `<h1>` is the same shape
 * `_staff/students/$studentId.tsx` already uses, and it's deliberate: a
 * heading that says nothing yet is worse to be dropped onto than the
 * landmark. Section titles are `<h2>`, which `useRouteFocus` never looks
 * at.
 *
 * Region config comes from a **value-less** `RegionConfigProvider` (the
 * locale-derived BD default), not `useTenantRegionConfig()`: that hook
 * reads `GET /schools/:id/settings`, which is `@Roles(SUPER_ADMIN, ADMIN)`
 * — a PARENT calling it gets a 403 on every page load for a value it
 * would then fall back from anyway. Same reasoning `login.tsx` uses for
 * its own value-less provider. Without *any* provider, `useRegionConfig()`
 * returns the `bn-BD` context default regardless of the active locale,
 * which would render Bengali numerals to an English-locale parent.
 */
export const Route = createFileRoute('/portal/')({
  // [8.14.5]: `myStudentsQueryOptions()` — every branch below (single
  // student vs. multi-child) reads through `useMyStudents()` first, so
  // this is the one query worth warming ahead of the route committing;
  // the per-student `useFeeDues`/`usePaymentsByStudent` calls stay as
  // plain hooks, same reasoning `students/$studentId.tsx`'s own
  // per-tab queries do.
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `_staff/academic-years/index.tsx`'s
      // identical comment for why.
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(() => undefined),
      loadRouteNamespaces('portal', 'common'),
    ]),
  pendingComponent: PortalOverviewPending,
  component: PortalOverviewRoute,
});

function PortalOverviewRoute() {
  return (
    <RegionConfigProvider>
      <PortalOverview />
    </RegionConfigProvider>
  );
}

/** One child's row on this page, merged from `/students/mine` (the source
 * of truth for *who* the children are) and `/fees/dues` (which omits
 * paid-up students entirely — hence the merge rather than reading the
 * dues response alone). */
interface ChildSummary {
  id: string;
  fullName: string;
  meta: string;
  totalDue: number;
  /** The part of `totalDue` whose due date has already passed. Always
   * `<= totalDue`; `0` when nothing is overdue yet. */
  overdueDue: number;
  status: FeeStatus;
  /** Earliest unpaid due date, or `null` when nothing is outstanding. */
  dueDate: string | null;
  /** Whole days past the earliest overdue date, or `null` when nothing is
   * overdue. */
  daysLate: number | null;
}

const MS_PER_DAY = 86_400_000;

function daysBetween(due: string, now: Date): number {
  const dueDate = parseServerDate(due);
  return Math.floor((now.getTime() - dueDate.getTime()) / MS_PER_DAY);
}

/**
 * **`FeeStatus.OVERDUE` never appears in a dues entry — do not test for
 * it.** `GET /fees/dues` only ever selects fees whose status is `PENDING`
 * or `PARTIALLY_PAID` (`fee-dues.service.ts`'s `OPEN_STATUSES`), and
 * nothing on the server ever writes `OVERDUE` into `student_fees` at all;
 * the only mention of it server-side is a read filter. A page that keyed
 * "overdue" off `due.status` would show a parent six months late a neutral
 * "Pending" badge — which is exactly what this page did before it was
 * fixed.
 *
 * The row's own `months_overdue` is the real signal, and it is present on
 * the family DTO: the server computes it as `COUNT(*) FILTER (WHERE
 * sf.due_date IS NOT NULL AND sf.due_date < CURRENT_DATE)` — a fee due
 * *today* is current, not yet late. This is the same
 * derivation the staff dues queue uses (`_staff/fees/dues.tsx`'s
 * `deriveRowStatus`) — deliberately reused rather than a second, parallel
 * rule that could drift from it.
 */
function deriveStatus(row: FeeDueRow | undefined): FeeStatus {
  if (row === undefined || row.total_due <= 0 || row.dues.length === 0) return FeeStatus.PAID;
  if (row.months_overdue > 0) return FeeStatus.OVERDUE;
  return row.dues.some((due) => due.status === FeeStatus.PARTIALLY_PAID)
    ? FeeStatus.PARTIALLY_PAID
    : FeeStatus.PENDING;
}

/** `schema.d.ts` types `payment_status` as a string-literal union, not as
 * the shared enum object, so the two are compared through this widened
 * alias rather than directly against an enum member. */
type PaymentStatusValue = `${PaymentStatus}`;
const RECEIVED_STATUS: PaymentStatusValue = PaymentStatus.SUCCESS;

/**
 * A payment only means "money received" when it succeeded.
 * `CreatePaymentDto.payment_status` accepts the whole `PaymentStatus`
 * enum, so `FAILED` (a bounced cheque), `PENDING` (a cheque still
 * clearing) and `REFUNDED` rows are all really in the data — and none of
 * them may feed a line that tells a parent their fees are settled.
 *
 * Note this gates the *claims*, not the *rows*: see `RecentPayments` for
 * why a failed attempt is still listed, just labelled.
 */
function isReceived(payment: { payment_status: PaymentStatusValue }): boolean {
  return payment.payment_status === RECEIVED_STATUS;
}

/** The client-side twin of the server's `months_overdue` predicate above,
 * applied to one entry so the *amount* overdue can be separated from the
 * amount merely outstanding. Same test the SQL runs, so the two can't
 * disagree about which months count. */
function isPastDue(due: { due_date: string | null }, now: Date): boolean {
  return isPastDueDate(due.due_date, now);
}

function toneFor(status: FeeStatus): string {
  if (status === FeeStatus.OVERDUE) return 'text-status-overdue-fg';
  if (status === FeeStatus.PAID) return 'text-status-paid-fg';
  return 'text-status-due-fg';
}

function summarize(
  students: Student[],
  rows: FeeDueRow[],
  formatMeta: (className: string | null, section: string, roll: number) => string,
  now: Date,
): ChildSummary[] {
  return students.map((student) => {
    const row = rows.find((candidate) => candidate.student_id === student.id);
    const status = deriveStatus(row);
    const unpaid = (row?.dues ?? []).filter((due) => due.balance > 0 && due.due_date !== null);
    const earliest = unpaid
      .map((due) => due.due_date as string)
      .sort((a, b) => a.localeCompare(b))[0];
    // Gated on the row's own `months_overdue` rather than on the date test
    // alone, so the server's answer to "is this child overdue?" stays
    // authoritative and a clock skew here can't invent an overdue child
    // the badge doesn't agree with.
    const pastDue = status === FeeStatus.OVERDUE ? unpaid.filter((due) => isPastDue(due, now)) : [];
    const earliestOverdue = pastDue
      .map((due) => due.due_date as string)
      .sort((a, b) => a.localeCompare(b))[0];

    return {
      id: student.id,
      fullName: student.full_name,
      meta: formatMeta(
        student.class_section?.class?.name ?? null,
        student.class_section?.section_name ?? '',
        student.roll_number,
      ),
      totalDue: row?.total_due ?? 0,
      // The overdue *portion*, not the whole balance: a child who is
      // ৳2,000 overdue and ৳3,000 not-yet-due is ৳2,000 overdue, and
      // rolling the two together would overstate the hero's overdue line.
      overdueDue: pastDue.reduce((sum, due) => sum + due.balance, 0),
      status,
      dueDate: earliest ?? null,
      daysLate:
        earliestOverdue === undefined ? null : Math.max(daysBetween(earliestOverdue, now), 0),
    };
  });
}

function PortalOverview() {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();
  const studentsQuery = useMyStudents();
  // No filters beyond a generous page size: the server scopes this to the
  // caller's own linked students for a PARENT/STUDENT regardless of what
  // is passed, and a family's set is small enough that one page is all of
  // it.
  const duesQuery = useFeeDues({ limit: 50 });

  // A student always arrives with `class_section` loaded
  // (`family-access.service.ts` selects it), but the type allows it to be
  // absent — falling back to the roll alone beats rendering the word
  // "undefined" next to a child's name if that ever changes.
  const formatMeta = (className: string | null, section: string, roll: number) =>
    className === null
      ? t('children.metaNoClass', { roll })
      : t('children.meta', { className, section, roll });

  if (studentsQuery.isPending || duesQuery.isPending) {
    return <PortalSkeleton label={t('loading.label')} studentCount={studentsQuery.data?.length} />;
  }

  if (studentsQuery.isError || duesQuery.isError) {
    return (
      <ErrorState
        message={t('error.message')}
        retryLabel={t('error.retry')}
        onRetry={() => {
          void studentsQuery.refetch();
          void duesQuery.refetch();
        }}
      />
    );
  }

  const students = studentsQuery.data;

  if (students.length === 0) {
    // Not an error: an unlinked parent is a real, expected account state
    // that only the school office can resolve, so the copy names that fix
    // rather than offering a retry as if the request had failed.
    return (
      <EmptyState
        title={t('empty.title')}
        explanation={t('empty.explanation')}
        action={{
          label: t('empty.action'),
          onClick: () => {
            void studentsQuery.refetch();
            void duesQuery.refetch();
          },
        }}
      />
    );
  }

  const children = summarize(students, duesQuery.data.data, formatMeta, new Date());

  if (children.length === 1) {
    const only = children[0] as ChildSummary;
    return <SingleStudentView child={only} config={config} />;
  }

  return <MultiChildView items={children} config={config} />;
}

function PortalSkeleton({
  label,
  studentCount,
}: {
  label: string;
  // `studentsQuery.data?.length` from the caller — defined once that
  // query resolves, even while `duesQuery` is still pending. Undefined
  // while `studentsQuery` is itself still pending, which is the only
  // time the eventual branch (`MultiChildView` vs `SingleStudentView`)
  // is genuinely unknown here.
  studentCount: number | undefined;
}) {
  if (studentCount === 1) {
    return (
      // No `<h1>` while pending — see this file's header comment. The
      // `aria-busy` region carries the state for a screen reader instead,
      // so the frame is never silently blank.
      // Mirrors `SingleStudentView`'s own frame: the name+meta header (not
      // a `Card`), the hero `Card`, then `RecentPayments`' card shell —
      // that query has its own pending skeleton, so only its shell height
      // is approximated here.
      <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
        <span className="sr-only">{label}</span>
        <div className="flex flex-col gap-0.5">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-[6.5rem] w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  return (
    // No `<h1>` while pending — see this file's header comment. The
    // `aria-busy` region carries the state for a screen reader instead, so
    // the frame is never silently blank.
    // `max-w-2xl` and `gap-3` are `MultiChildView`'s own container classes,
    // and the three heights below are the boxes it actually renders: the
    // hero `Card` (p-4 around a label, a `text-3xl` figure and a meta
    // line), the uppercase section label, and a `ChildCard` (p-3.5 around
    // a name row, a meta line and an amount/badge row). ([8.13.11])
    //
    // Also the fallback while `studentCount` is still unknown (neither
    // query has resolved) — see this file's header comment on why a
    // single student is the less common case, so a shape that's wrong for
    // neither branch is wrong for both.
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-[7.25rem] w-full rounded-lg" />
      <Skeleton className="mt-1 h-4 w-32" />
      <Skeleton className="h-[6.25rem] w-full rounded-lg" />
      <Skeleton className="h-[6.25rem] w-full rounded-lg" />
    </div>
  );
}

function MultiChildView({ items, config }: { items: ChildSummary[]; config: RegionConfig }) {
  const { t } = useTranslation('portal');

  const withDue = items.filter((child) => child.totalDue > 0);
  const total = withDue.reduce((sum, child) => sum + child.totalDue, 0);
  // Sums each child's overdue *portion*, not the whole balance of every
  // child who happens to be flagged overdue.
  const overdueTotal = items.reduce((sum, child) => sum + child.overdueDue, 0);

  const metaParts = [t('hero.acrossChildren', { withDue: withDue.length, total: items.length })];
  if (overdueTotal > 0) {
    metaParts.push(t('hero.overdueAmount', { amount: formatServerAmount(overdueTotal, config) }));
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <Card className="flex flex-col gap-1 p-4">
        {/* The page's one `<h1>` in this frame. Element choice only — the
            visual weight stays the mockup's small muted label, the same
            way `EmptyState`'s title is an `<h1>` that doesn't look like
            one. */}
        <h1 className="text-sm font-normal text-muted-foreground">{t('hero.label')}</h1>
        <div
          className={`text-3xl leading-tight font-bold tabular-nums ${toneFor(
            overdueTotal > 0 ? FeeStatus.OVERDUE : FeeStatus.PENDING,
          )}`}
        >
          {total > 0 ? formatServerAmount(total, config) : t('hero.nothingDue')}
        </div>
        <div className="text-xs text-muted-foreground">
          {total > 0 ? metaParts.join(' · ') : t('hero.allSettled')}
        </div>
      </Card>

      <h2 className="mt-1 px-0.5 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {t('children.title')}
      </h2>

      {items.map((child) => (
        <ChildCard key={child.id} child={child} config={config} />
      ))}
    </div>
  );
}

function ChildCard({ child, config }: { child: ChildSummary; config: RegionConfig }) {
  const { t } = useTranslation('portal');

  const dueParts: string[] = [];
  if (child.dueDate !== null) {
    dueParts.push(t('hero.dueOn', { date: formatDate(parseServerDate(child.dueDate), config) }));
  }
  if (child.daysLate !== null) {
    dueParts.push(t('hero.daysLate', { count: child.daysLate }));
  }

  return (
    // The whole card is the link — one target rather than a "view" link
    // inside a card, which is both a smaller tap area and a nested
    // interactive element for a screen reader to step through. The
    // accessible name is the card's own text (name, class, amount,
    // status), so no `aria-label` is needed or wanted: an override would
    // hide the very figures the parent is scanning for.
    <Card asChild>
      <Link
        to="/portal/fees"
        search={{ student: child.id }}
        className="flex flex-col gap-1.5 p-3.5 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">{child.fullName}</span>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="text-xs text-muted-foreground">{child.meta}</div>
        {/* `flex-wrap` is what keeps this row honest at 320px: the amount
            and the badge stack instead of the badge being pushed off. */}
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={`text-base font-bold tabular-nums ${toneFor(child.status)}`}>
            {child.totalDue > 0 ? formatServerAmount(child.totalDue, config) : t('hero.nothingDue')}
          </span>
          {/* The badge is why the amount's colour is never the only carrier
              of status — it repeats the same meaning as text. */}
          <StatusBadge domain="fee" status={child.status} />
        </div>
        {dueParts.length > 0 && (
          <div className="text-xs text-muted-foreground">{dueParts.join(' · ')}</div>
        )}
      </Link>
    </Card>
  );
}

function SingleStudentView({ child, config }: { child: ChildSummary; config: RegionConfig }) {
  const { t } = useTranslation('portal');
  const paymentsQuery = usePaymentsByStudent(child.id);

  const metaParts: string[] = [];
  if (child.dueDate !== null) {
    metaParts.push(t('hero.dueOn', { date: formatDate(parseServerDate(child.dueDate), config) }));
  }
  if (child.daysLate !== null) {
    metaParts.push(t('hero.daysLate', { count: child.daysLate }));
  }

  // Only a *received* payment can date this line — a bounced cheque
  // recorded last week must not read as "Last paid last week".
  const lastPayment = paymentsQuery.data?.find(isReceived);
  if (metaParts.length === 0 && lastPayment !== undefined) {
    metaParts.push(
      t('hero.lastPaid', { date: formatDate(parseServerDate(lastPayment.payment_date), config) }),
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        {/* This frame's `<h1>`: the student is the subject of the page,
            mirroring `DetailShell`'s name-as-heading on the staff side. */}
        <h1 className="text-lg font-semibold tracking-tight">{child.fullName}</h1>
        <p className="text-xs text-muted-foreground">{child.meta}</p>
      </div>

      <Card className="flex flex-col gap-1 p-4">
        {/* A `<div>`, not an `<h1>` — the student's name above already is
            this frame's page heading. */}
        <div className="text-sm text-muted-foreground">{t('hero.label')}</div>
        <div className={`text-3xl leading-tight font-bold tabular-nums ${toneFor(child.status)}`}>
          {child.totalDue > 0 ? formatServerAmount(child.totalDue, config) : t('hero.nothingDue')}
        </div>
        {metaParts.length > 0 && (
          <div className="text-xs text-muted-foreground">{metaParts.join(' · ')}</div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/portal/fees">{t('actions.viewFeeBreakdown')}</Link>
          </Button>
        </div>
      </Card>

      <RecentPayments query={paymentsQuery} config={config} />
    </div>
  );
}

/** Payment-method labels via an exhaustive switch rather than a computed
 * `t(\`payments.method.${method}\`)` — a computed key is invisible to
 * `check-i18n-keys.mjs`, so a method whose translation was never added
 * would ship as a raw enum value instead of failing the build. */
function usePaymentMethodLabel(): (method: string) => string {
  const { t } = useTranslation('portal');
  return (method: string) => {
    switch (method) {
      case 'CASH':
        return t('payments.method.CASH');
      case 'CHEQUE':
        return t('payments.method.CHEQUE');
      case 'BANK_TRANSFER':
        return t('payments.method.BANK_TRANSFER');
      case 'ONLINE':
        return t('payments.method.ONLINE');
      case 'CARD':
        return t('payments.method.CARD');
      case 'UPI':
        return t('payments.method.UPI');
      default:
        return method;
    }
  };
}

/**
 * **Product decision — a non-successful payment is shown, labelled, not
 * hidden.** `payment_status` can be `FAILED`, `PENDING` or `REFUNDED` as
 * well as `SUCCESS`, and both alternatives to labelling are worse than
 * it:
 *
 * - Rendering them unlabelled tells a parent whose cheque bounced that
 *   the school received their money.
 * - Filtering them out silently means a parent who paid yesterday and
 *   whose cheque is still clearing sees "No payments recorded yet", and
 *   pays a second time.
 *
 * So every row is listed, and any row that is not `SUCCESS` carries a
 * `StatusBadge` naming its actual state. What is gated on success is the
 * *claim* that money arrived: the hero's "Last paid" line (see
 * `isReceived`). Revisit if a school ever accumulates enough failed
 * attempts to push real receipts out of the top three.
 */
function RecentPayments({
  query,
  config,
}: {
  query: ReturnType<typeof usePaymentsByStudent>;
  config: RegionConfig;
}) {
  const { t } = useTranslation('portal');
  const methodLabel = usePaymentMethodLabel();

  return (
    <Card className="flex flex-col">
      <h2 className="border-b border-border-subtle px-3.5 py-3 text-sm font-semibold">
        {t('payments.title')}
      </h2>

      {query.isPending ? (
        <div className="flex flex-col gap-2 p-3.5" aria-busy="true">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : query.isError ? (
        <div className="p-3.5">
          <ErrorState
            message={t('payments.loadError')}
            retryLabel={t('payments.retry')}
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : query.data.length === 0 ? (
        // Deliberately not `EmptyState`: its `title` renders an `<h1>`,
        // and this frame's `<h1>` is already the student's name.
        <p className="p-3.5 text-sm text-muted-foreground">{t('payments.none')}</p>
      ) : (
        <>
          {query.data.slice(0, 3).map((payment, index) => {
            // Only fields both `Payment` and `FamilyPaymentDto` carry —
            // a family caller's rows have no `student`/`received_by`, and
            // there is no receipt number on either shape (the mockup's
            // "receipt RCP-4471" had no backing field), so the secondary
            // line is the method plus the transaction reference when the
            // school recorded one.
            const detail = [methodLabel(payment.payment_method)];
            if (payment.transaction_reference) detail.push(payment.transaction_reference);
            const received = isReceived(payment);

            return (
              <div
                key={payment.id}
                className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 ${
                  index > 0 ? 'border-t border-border-subtle' : ''
                }`}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm">
                    {formatDate(parseServerDate(payment.payment_date), config)}
                  </span>
                  <span className="text-xs text-muted-foreground">{detail.join(' · ')}</span>
                </div>
                <span className="flex items-center gap-2">
                  {/* A non-successful payment is shown, not dropped —
                      but never as a bare amount that reads as received.
                      The badge is the carrier; the muted amount is only a
                      second, redundant signal. */}
                  {!received && (
                    <StatusBadge
                      domain="payment"
                      status={payment.payment_status as PaymentStatus}
                    />
                  )}
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      received ? '' : 'text-muted-foreground'
                    }`}
                  >
                    {formatServerAmount(payment.total_amount, config)}
                  </span>
                </span>
              </div>
            );
          })}
          <div className="border-t border-border-subtle px-3.5 py-2.5">
            <Link to="/portal/fees" className="text-sm text-primary underline">
              {t('payments.seeAll')}
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}

function PortalOverviewPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}
