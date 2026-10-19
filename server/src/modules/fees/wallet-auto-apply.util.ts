import { FeeStatus } from '@biddaloy/shared';
import { toPaisa } from '../../common/constants/money';

/** Whole-paisa wallet auto-apply for a freshly generated bill [F-143]. Compared in
 * integer paisa: PAID only when nothing at all is left owed. */
export function autoApply(
  balance: number,
  total: number,
  discount: number,
): { toApply: number; status: FeeStatus } {
  const due = toPaisa(total) - toPaisa(discount);
  const apply = Math.min(toPaisa(balance), due);
  return {
    toApply: apply / 100,
    status: apply >= due ? FeeStatus.PAID : FeeStatus.PARTIALLY_PAID,
  };
}
