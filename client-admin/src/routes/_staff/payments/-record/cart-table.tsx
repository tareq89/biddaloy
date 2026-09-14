/**
 * [16.4.4] Presentational — no data fetching. One `Table` per selected
 * student (grouped when more than one is selected), plus footer rows for
 * subtotal, the wallet-credit toggle, and the amount due. All arithmetic
 * happens in integer minor units (never `x / 100`) — `serverAmountToMinorUnits`
 * converts the cart response's decimal `balance`/`total_amount` fields once,
 * at read time, and `formatCurrency` renders minor units directly.
 */
import { FeeStatus } from '@biddaloy/shared';
import {
  Checkbox,
  MoneyInput,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import type { CartBill, CartStudent } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { useTranslation } from '@biddaloy/ui/i18n';
import {
  formatCurrency,
  formatDate,
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
    return <p className="text-sm text-muted-foreground">{t('record.cart.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {students.map((student) =>
        student.bills.length === 0 ? null : (
          <div key={student.id} className="flex flex-col gap-1">
            {students.length > 1 && <p className="text-sm font-medium">{student.full_name}</p>}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('record.cart.columnFee')}</TableHead>
                  <TableHead>{t('record.cart.columnPeriod')}</TableHead>
                  <TableHead>{t('record.cart.columnDueDate')}</TableHead>
                  <TableHead>{t('record.cart.columnBalance')}</TableHead>
                  <TableHead>{t('record.cart.columnPay')}</TableHead>
                  <TableHead>{t('record.cart.columnDiscount')}</TableHead>
                  <TableHead>{t('record.cart.columnTotal')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {student.bills.map((bill) => {
                  const line = lines.get(bill.student_fee_id) ?? {
                    payMinorUnits: 0,
                    discountMinorUnits: 0,
                  };
                  const balanceMinorUnits = serverAmountToMinorUnits(bill.balance, config);
                  const lineTotalMinorUnits = line.payMinorUnits + line.discountMinorUnits;
                  return (
                    <TableRow key={bill.student_fee_id}>
                      <TableCell>{bill.fee_name}</TableCell>
                      <TableCell>
                        {formatDate(parseServerDate(bill.period_start), config)}
                      </TableCell>
                      <TableCell className={bill.is_overdue ? 'text-destructive' : undefined}>
                        {bill.due_date !== null
                          ? formatDate(parseServerDate(bill.due_date), config)
                          : '—'}
                      </TableCell>
                      <TableCell>{formatCurrency(balanceMinorUnits, config)}</TableCell>
                      <TableCell>
                        <MoneyInput
                          aria-label={t('record.cart.columnPay')}
                          config={config}
                          value={line.payMinorUnits}
                          onValueChange={(next) =>
                            onLineChange(bill.student_fee_id, { payMinorUnits: next ?? 0 })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <DiscountCell
                          value={line.discountMinorUnits}
                          balance={balanceMinorUnits}
                          pay={line.payMinorUnits}
                          config={config}
                          onDiscountChange={(next) =>
                            onLineChange(bill.student_fee_id, { discountMinorUnits: next })
                          }
                          isValid={lineValidity.get(bill.student_fee_id) ?? true}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {formatCurrency(lineTotalMinorUnits, config)}
                          {bill.is_late_fee && (
                            <span className="rounded-full bg-status-due-bg px-2 py-0.5 text-xs text-status-due-fg">
                              {t('record.cart.lateFee')}
                            </span>
                          )}
                          <StatusBadge domain="fee" status={deriveBillStatus(bill)} />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        ),
      )}

      <Table>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={6}>{t('record.cart.subtotal')}</TableCell>
            <TableCell>{formatCurrency(subtotalMinorUnits, config)}</TableCell>
          </TableRow>
          {walletBalanceMinorUnits > 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={walletUseMinorUnits > 0}
                    onCheckedChange={(checked) =>
                      onWalletUseChange(
                        checked === true
                          ? Math.min(walletBalanceMinorUnits, subtotalMinorUnits)
                          : 0,
                      )
                    }
                  />
                  {t('record.cart.walletCredit', {
                    amount: formatCurrency(walletBalanceMinorUnits, config),
                  })}
                </label>
              </TableCell>
              <TableCell>{formatCurrency(walletUseMinorUnits, config)}</TableCell>
            </TableRow>
          )}
          <TableRow>
            <TableCell colSpan={6} className="font-medium">
              {t('record.cart.amountDue')}
            </TableCell>
            <TableCell className="font-medium">
              {formatCurrency(amountDueMinorUnits, config)}
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
