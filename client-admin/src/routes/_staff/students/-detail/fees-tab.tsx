import { FeeStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import {
  useHasPermission,
  useStudentFeeSummary,
  useStudentWallet,
  type StudentFee,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount, isPastDueDate, parseServerDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { RecordPaymentModal } from '../../payments/-record/record-payment-modal';

import { DiscountsSection } from './discounts-section';
import { TabQueryState } from './tab-query-state';

export interface FeesTabProps {
  studentId: string;
}

const OPEN_STATUSES: string[] = [FeeStatus.PENDING, FeeStatus.PARTIALLY_PAID, FeeStatus.OVERDUE];
const HISTORY_PAGE_SIZE = 10;

/**
 * [16.4.5] wires "Record payment" to the real modal from #661. The
 * modal only accepts a `studentId` pre-selection, not specific fee
 * lines, so `opts.feeIds` is accepted for forward-compatibility but
 * currently unused.
 */
function useRecordPaymentSeam() {
  const [open, setOpen] = React.useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- forward-compat: kept until the modal supports pre-selecting fee lines
  const openModal = React.useCallback((_studentId: string, _opts?: { feeIds?: string[] }) => {
    setOpen(true);
  }, []);
  return { open, setOpen, openModal };
}

/** `StudentFee`'s money columns are Postgres `decimal` — the pg driver
 * (and this ticket's mocked fixtures) send those as **strings**, even
 * though `schema.d.ts` types them `number` because it's generated from
 * the entity column type, not the wire shape. `+` on two such fields
 * concatenates ("0.00" + "0.00" -> "0.000.00") instead of adding, which
 * throws once the result reaches `formatServerAmount`'s parser. Every
 * other reader of `fee_breakdown` (`portal/fees.tsx`'s `balanceOf`,
 * `getInvoiceSummary` in `fees.service.ts`) goes through `Number()`
 * first — same fix here. */
function discountOf(fee: StudentFee): number {
  return Number(fee.standing_discount_amount) + Number(fee.one_off_discount_amount);
}

function balanceOf(fee: StudentFee): number {
  return Number(fee.total_amount) - Number(fee.paid_amount) - Number(fee.discount_amount);
}

/**
 * **Never trust `fee.status` to say "overdue".** Nothing server-side ever
 * writes `OVERDUE` into `student_fees` — the only mention of it there is a
 * read filter — so rendering `fee.status` verbatim would badge a bill six
 * months late as neutral "Pending". Same derivation as
 * `portal/fees.tsx`'s `deriveMonthStatus` / `dues.tsx`'s `deriveRowStatus`.
 */
function deriveFeeStatus(fee: StudentFee, now: Date): FeeStatus {
  if (balanceOf(fee) <= 0) return fee.status as FeeStatus;
  if (isPastDueDate(fee.due_date, now)) return FeeStatus.OVERDUE;
  return fee.status as FeeStatus;
}

/** [16.4.5]'s per-fee-line table, shared by the "Open bills" and
 * "History" sections below — same columns `dues.tsx`'s `DuesFeeLines`
 * renders for its own expanded row, built from the same server-side
 * `StudentFee` shape (`fee_breakdown` on `useStudentFeeSummary`'s
 * response) rather than a dedicated per-student dues endpoint, which
 * doesn't exist — see this file's PR note. */
function FeeLinesTable({
  fees,
  emptyMessage,
  onRecordPayment,
}: {
  fees: StudentFee[];
  emptyMessage: string;
  onRecordPayment?: ((feeId: string) => void) | undefined;
}) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const now = new Date();

  if (fees.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  function periodLabel(fee: StudentFee): string {
    const date = formatDate(parseServerDate(fee.period_start), regionConfig);
    return fee.occurrence > 1 ? `${date} (${fee.occurrence})` : date;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('detail.fees.columnFee')}</TableHead>
          <TableHead>{t('detail.fees.columnPeriod')}</TableHead>
          <TableHead>{t('detail.fees.columnDueDate')}</TableHead>
          <TableHead>{t('detail.fees.columnAmount')}</TableHead>
          <TableHead>{t('detail.fees.columnDiscount')}</TableHead>
          <TableHead>{t('detail.fees.columnPaid')}</TableHead>
          <TableHead>{t('detail.fees.columnBalance')}</TableHead>
          <TableHead>{t('detail.fees.columnStatus')}</TableHead>
          {onRecordPayment && <TableHead>{t('detail.fees.columnActions')}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {fees.map((fee) => (
          <TableRow key={fee.id}>
            <TableCell>
              <span className="flex items-center gap-2">
                {fee.fee_structure.name}
                {fee.late_fee_for_student_fee_id !== null && (
                  <span className="inline-flex items-center rounded-full bg-status-overdue-bg px-2 py-0.5 text-xs font-medium text-status-overdue-fg">
                    {t('detail.fees.lateFeeBadge')}
                  </span>
                )}
              </span>
            </TableCell>
            <TableCell>{periodLabel(fee)}</TableCell>
            <TableCell>
              {fee.due_date ? formatDate(parseServerDate(fee.due_date), regionConfig) : '—'}
            </TableCell>
            <TableCell className="tabular-nums">
              {formatServerAmount(fee.total_amount, regionConfig)}
            </TableCell>
            <TableCell className="tabular-nums">
              {formatServerAmount(discountOf(fee), regionConfig)}
            </TableCell>
            <TableCell className="tabular-nums">
              {formatServerAmount(fee.paid_amount, regionConfig)}
            </TableCell>
            <TableCell className="tabular-nums">
              {formatServerAmount(balanceOf(fee), regionConfig)}
            </TableCell>
            <TableCell>
              <StatusBadge domain="fee" status={deriveFeeStatus(fee, now)} />
            </TableCell>
            {onRecordPayment && (
              <TableCell>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onRecordPayment(fee.id)}
                >
                  {t('detail.fees.recordPayment')}
                </Button>
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function WalletSection({ studentId }: { studentId: string }) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const walletQuery = useStudentWallet(studentId);

  return (
    <TabQueryState
      query={walletQuery}
      forbiddenMessage={t('detail.forbidden')}
      errorMessage={t('detail.fees.walletErrorMessage')}
    >
      {(wallet) => {
        // "last 10 transactions" per [16.4.5]'s Step 2 — the endpoint
        // itself pages at 50 (`WALLET_HISTORY_LIMIT`,
        // `wallet.controller.ts`), newest first; sliced further here
        // rather than adding a second, smaller page size server-side.
        const recent = wallet.transactions.slice(0, 10);
        return (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-border-subtle p-4">
              <p className="text-sm text-muted-foreground">{t('detail.fees.walletBalance')}</p>
              <p className="text-lg font-semibold tabular-nums">
                {formatServerAmount(wallet.balance, regionConfig)}
              </p>
            </div>
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('detail.fees.walletEmptyMessage')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('detail.fees.walletColumnDate')}</TableHead>
                    <TableHead>{t('detail.fees.walletColumnKind')}</TableHead>
                    <TableHead>{t('detail.fees.walletColumnAmount')}</TableHead>
                    <TableHead>{t('detail.fees.walletColumnNote')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recent.map((tx, index) => (
                    // Staff transactions carry `id`; the reduced
                    // PARENT/STUDENT shape (`FamilyWalletTransactionDto`)
                    // doesn't — `created_at` isn't guaranteed unique
                    // either (same-second transactions), so the index is
                    // folded in as a tiebreaker.
                    <TableRow
                      key={
                        'id' in tx && typeof tx.id === 'string'
                          ? tx.id
                          : `${tx.created_at}-${index}`
                      }
                    >
                      <TableCell>{formatDate(new Date(tx.created_at), regionConfig)}</TableCell>
                      <TableCell>
                        {t(`walletTransactionKind.${tx.kind}`, {
                          ns: 'common',
                          defaultValue: tx.kind,
                        })}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {formatServerAmount(tx.amount, regionConfig)}
                      </TableCell>
                      {/* [16.8.2] `note` is staff free text and is no longer
                          part of the family shape at all, so it is only
                          present on the staff variant of this union. */}
                      <TableCell>
                        {'note' in tx && typeof tx.note === 'string' ? tx.note : '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        );
      }}
    </TabQueryState>
  );
}

function HistorySection({ fees }: { fees: StudentFee[] }) {
  const { t } = useTranslation('students');
  const paid = React.useMemo(
    () => fees.filter((fee) => !OPEN_STATUSES.includes(fee.status)),
    [fees],
  );
  const [page, setPage] = React.useState(1);
  const totalPages = Math.max(1, Math.ceil(paid.length / HISTORY_PAGE_SIZE));
  // The paid set can shrink between renders (refetch after a payment is
  // reversed, etc.) — clamp so a stale `page` never strands the user past
  // the last real page with an empty table and no way back.
  const clampedPage = Math.min(page, totalPages);
  const pageItems = paid.slice(
    (clampedPage - 1) * HISTORY_PAGE_SIZE,
    clampedPage * HISTORY_PAGE_SIZE,
  );

  return (
    <div className="flex flex-col gap-3">
      <FeeLinesTable fees={pageItems} emptyMessage={t('detail.fees.historyEmptyMessage')} />
      {paid.length > HISTORY_PAGE_SIZE && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={clampedPage <= 1}
            onClick={() => setPage(clampedPage - 1)}
          >
            {t('detail.fees.previousPage')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('detail.fees.pageOf', { page: clampedPage, totalPages })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={clampedPage >= totalPages}
            onClick={() => setPage(clampedPage + 1)}
          >
            {t('detail.fees.nextPage')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** [8.10.2]'s AC: "Fees tab shows outstanding, paid balance clearly."
 * [16.4.5] rewrites the breakdown below the summary tiles into three
 * sections — Open bills / Wallet / History — plus a disabled "Recurring
 * fees" placeholder tab reserved for 16.7.5 (not implemented here). */
export function FeesTab({ studentId }: FeesTabProps) {
  const { t } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const query = useStudentFeeSummary(studentId);
  const recordPayment = useRecordPaymentSeam();
  const onRecordPayment = recordPayment.openModal;
  const canCollectFees = useHasPermission(Permission.FEE_COLLECT);

  function money(amount: number | string): string {
    return formatServerAmount(amount, regionConfig);
  }

  return (
    <>
      <TabQueryState
        query={query}
        forbiddenMessage={t('detail.forbidden')}
        errorMessage={t('detail.fees.errorMessage')}
      >
        {(feeSummary) => {
          const openBills = feeSummary.fee_breakdown.filter((fee) =>
            OPEN_STATUSES.includes(fee.status),
          );
          return (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-lg border border-border-subtle p-4">
                  <p className="text-sm text-muted-foreground">{t('detail.fees.totalBilled')}</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {money(feeSummary.summary.total_due)}
                  </p>
                </div>
                <div className="rounded-lg border border-border-subtle p-4">
                  <p className="text-sm text-muted-foreground">{t('detail.fees.totalPaid')}</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {money(feeSummary.summary.total_paid)}
                  </p>
                </div>
                <div className="rounded-lg border border-border-subtle p-4">
                  <p className="text-sm text-muted-foreground">{t('detail.fees.outstanding')}</p>
                  <p className="text-lg font-semibold tabular-nums">
                    {money(feeSummary.summary.balance)}
                  </p>
                </div>
              </div>
              <Tabs defaultValue="open-bills">
                <TabsList>
                  <TabsTrigger value="open-bills">{t('detail.fees.openBillsTab')}</TabsTrigger>
                  <TabsTrigger value="wallet">{t('detail.fees.walletTab')}</TabsTrigger>
                  <TabsTrigger value="history">{t('detail.fees.historyTab')}</TabsTrigger>
                  <TabsTrigger value="discounts">{t('detail.fees.discountsTab')}</TabsTrigger>
                </TabsList>
                <TabsContent value="open-bills">
                  <FeeLinesTable
                    fees={openBills}
                    emptyMessage={t('detail.fees.emptyMessage')}
                    onRecordPayment={
                      canCollectFees
                        ? (feeId) => onRecordPayment(studentId, { feeIds: [feeId] })
                        : undefined
                    }
                  />
                </TabsContent>
                <TabsContent value="wallet">
                  <WalletSection studentId={studentId} />
                </TabsContent>
                <TabsContent value="history">
                  <HistorySection fees={feeSummary.fee_breakdown} />
                </TabsContent>
                <TabsContent value="discounts">
                  <DiscountsSection studentId={studentId} />
                </TabsContent>
              </Tabs>
            </div>
          );
        }}
      </TabQueryState>
      <RecordPaymentModal
        open={recordPayment.open}
        onOpenChange={recordPayment.setOpen}
        studentId={studentId}
      />
    </>
  );
}
