/**
 * [16.4.4] Presentational — no data fetching. One bill list per selected
 * student (grouped when more than one is selected), plus a summary band for
 * subtotal, the wallet-credit toggle, and the amount due. [31.4] One DOM for
 * both sizes: a CSS grid that is a 7-column row on desktop and a stacked card
 * on a phone, so no control is mounted twice. All arithmetic
 * happens in integer minor units (never `x / 100`) — `serverAmountToMinorUnits`
 * converts the cart response's decimal `balance`/`total_amount` fields once,
 * at read time, and `formatCurrency` renders minor units directly.
 */
import { FeeStatus, PeriodType } from '@biddaloy/shared';
import { Checkbox, MoneyInput, StatusBadge } from '@biddaloy/ui/components';
import type { CartBill, CartStudent } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  formatCurrency,
  formatDate,
  formatMonth,
  parseServerDate,
  serverAmountToMinorUnits,
} from '@biddaloy/ui/utils';

import { DiscountCell } from './discount-cell';

export interface CartLineState {
  payMinorUnits: number;
  discountMinorUnits: number;
}

export interface CartTableProps {
  students: CartStudent[];
  lines: Map<string, CartLineState>;
  onLineChange: (studentFeeId: string, patch: Partial<CartLineState>) => void;
  /** F10/F13: `pay + discount ≤ balance` per bill, computed once by the
   * parent (`record-payment-modal.tsx`) from the same `lines` data
   * `canSubmit` reads. */
  lineValidity: Map<string, boolean>;
  config: RegionConfig;
  subtotalMinorUnits: number;
  walletBalanceMinorUnits: number;
  walletUseMinorUnits: number;
  onWalletUseChange: (walletUseMinorUnits: number) => void;
  amountDueMinorUnits: number;
}

function deriveBillStatus(bill: CartBill): FeeStatus {
  if (bill.is_overdue) return FeeStatus.OVERDUE;
  return bill.paid_amount > 0 ? FeeStatus.PARTIALLY_PAID : FeeStatus.PENDING;
}

// Desktop column track; the phone layout is a 2-column stack (see `BillRow`).
const ROW_GRID = 'md:grid-cols-[2fr_1fr_1fr_1fr_1fr_1.3fr_1.3fr]';

/** A phone-only visible label that stays in the accessibility tree on desktop,
 * where the (aria-hidden) header row shows it visually. */
function CellLabel({ children }: { children: string }) {
  return <span className="text-label text-text-secondary md:sr-only">{children}</span>;
}

export function CartTable({
  students,
  lines,
  onLineChange,
  lineValidity,
  config,
  subtotalMinorUnits,
  walletBalanceMinorUnits,
  walletUseMinorUnits,
  onWalletUseChange,
  amountDueMinorUnits,
}: CartTableProps) {
  const { t } = useTranslation('payments');
  const allBills = students.flatMap((student) => student.bills);

  if (allBills.length === 0) {
    return <p className="p-4 text-text-secondary md:px-5">{t('record.cart.empty')}</p>;
  }

  const headers = [
    t('record.cart.columnFee'),
    t('record.cart.columnPeriod'),
    t('record.cart.columnDueDate'),
    t('record.cart.columnStatus'),
    t('record.cart.columnBalance'),
    t('record.cart.columnPay'),
    t('record.cart.columnDiscount'),
  ];

  return (
    <div className="flex flex-col">
      {students.map((student) =>
        student.bills.length === 0 ? null : (
          <section key={student.id}>
            {students.length > 1 && (
              <h3 className="px-4 pt-4 text-h3 md:px-5">{student.full_name}</h3>
            )}
            <div
              aria-hidden="true"
              className={`hidden gap-x-4 border-y border-border-subtle bg-muted px-5 py-2 text-label text-text-secondary md:grid ${ROW_GRID}`}
            >
              {headers.map((header, index) => (
                <span key={header} className={index >= 4 ? 'text-right' : undefined}>
                  {header}
                </span>
              ))}
            </div>
            <ul className="divide-y divide-border-subtle">
              {student.bills.map((bill) => {
                const line = lines.get(bill.student_fee_id) ?? {
                  payMinorUnits: 0,
                  discountMinorUnits: 0,
                };
                const balanceMinorUnits = serverAmountToMinorUnits(bill.balance, config);
                const valid = lineValidity.get(bill.student_fee_id) ?? true;
                const periodText =
                  bill.period_type === (PeriodType.MONTH as string)
                    ? formatMonth(parseServerDate(bill.period_start), config)
                    : formatDate(parseServerDate(bill.period_start), config);
                const rowName = `${bill.fee_name} ${periodText}`;
                return (
                  <li
                    key={bill.student_fee_id}
                    className={`grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 md:items-center md:px-5 md:py-1 ${ROW_GRID}`}
                  >
                    <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1">
                      <span className="font-medium">{bill.fee_name}</span>
                      {bill.is_late_fee && (
                        <span className="rounded-full bg-status-due-bg px-2 py-0.5 text-label text-status-due-fg">
                          {t('record.cart.lateFee')}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col">
                      <CellLabel>{t('record.cart.columnPeriod')}</CellLabel>
                      <span>
                        {bill.period_type === (PeriodType.MONTH as string)
                          ? formatMonth(parseServerDate(bill.period_start), config)
                          : formatDate(parseServerDate(bill.period_start), config)}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <CellLabel>{t('record.cart.columnDueDate')}</CellLabel>
                      <span className={bill.is_overdue ? 'text-destructive' : undefined}>
                        {bill.due_date !== null
                          ? formatDate(parseServerDate(bill.due_date), config)
                          : '—'}
                      </span>
                    </div>
                    <div className="flex flex-col items-start">
                      <CellLabel>{t('record.cart.columnStatus')}</CellLabel>
                      <StatusBadge domain="fee" status={deriveBillStatus(bill)} />
                    </div>
                    <div className="flex flex-col md:text-right">
                      <CellLabel>{t('record.cart.columnBalance')}</CellLabel>
                      <span className="tabular-nums">
                        {formatCurrency(balanceMinorUnits, config)}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <CellLabel>{t('record.cart.columnPay')}</CellLabel>
                      <MoneyInput
                        aria-label={`${t('record.cart.columnPay')} — ${rowName}`}
                        config={config}
                        value={line.payMinorUnits}
                        aria-invalid={!valid}
                        className="text-right tabular-nums"
                        onValueChange={(next) =>
                          onLineChange(bill.student_fee_id, { payMinorUnits: next ?? 0 })
                        }
                      />
                      {!valid && (
                        <p className="text-label text-destructive">
                          {t('record.discount.exceedsBalance')}
                        </p>
                      )}
                    </div>
                    <div className="col-span-2 flex flex-col md:col-span-1">
                      <CellLabel>{t('record.cart.columnDiscount')}</CellLabel>
                      <DiscountCell
                        value={line.discountMinorUnits}
                        balance={balanceMinorUnits}
                        pay={line.payMinorUnits}
                        config={config}
                        onDiscountChange={(next) =>
                          onLineChange(bill.student_fee_id, { discountMinorUnits: next })
                        }
                        isValid={valid}
                        rowName={rowName}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ),
      )}

      <dl className="space-y-2 border-t border-border-subtle bg-muted p-4 md:px-5">
        <div className="flex items-center justify-between">
          <dt>{t('record.cart.subtotal')}</dt>
          <dd className="tabular-nums">{formatCurrency(subtotalMinorUnits, config)}</dd>
        </div>
        {walletBalanceMinorUnits > 0 && (
          <div className="flex items-center justify-between gap-2">
            <dt>
              <label className="flex min-h-11 items-center gap-3 md:min-h-8">
                <Checkbox
                  checked={walletUseMinorUnits > 0}
                  onCheckedChange={(checked) =>
                    onWalletUseChange(
                      checked === true ? Math.min(walletBalanceMinorUnits, subtotalMinorUnits) : 0,
                    )
                  }
                />
                {t('record.cart.walletCredit', {
                  amount: formatCurrency(walletBalanceMinorUnits, config),
                })}
              </label>
            </dt>
            <dd className="tabular-nums">{formatCurrency(walletUseMinorUnits, config)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border-subtle pt-2">
          <dt className="font-medium">{t('record.cart.amountDue')}</dt>
          <dd className="text-h3 tabular-nums">{formatCurrency(amountDueMinorUnits, config)}</dd>
        </div>
      </dl>
    </div>
  );
}
