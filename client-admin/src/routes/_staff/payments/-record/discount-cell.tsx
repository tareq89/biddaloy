/**
 * [16.4.4] A `MoneyInput` that stays visually locked (a lock icon,
 * `readOnly`) until the accountant clicks it — discounting a bill is
 * rare enough, and consequential enough (it triggers a step-up approval
 * prompt on submit — see `record-payment-modal.tsx`'s `useCheckout()`),
 * that it shouldn't be one accidental keystroke away from the Pay column
 * next to it.
 */
import { MoneyInput } from '@biddaloy/ui/components';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';
import * as React from 'react';

export interface DiscountCellProps {
  value: number;
  balance: number;
  pay: number;
  config: RegionConfig;
  onDiscountChange: (discountMinorUnits: number) => void;
  /** F10/F13: the combined `pay + discount ≤ balance` invariant, computed
   * once by the parent from the same `lines`/`balance` data `canSubmit`
   * reads — not recomputed here — so this cell's warning and the submit
   * gate can never disagree. Raising Pay after a discount was clamped in
   * flips this to `false` even though `commit`'s own clamp only runs when
   * the discount field itself changes. */
  isValid: boolean;
}

export function DiscountCell({
  value,
  balance,
  pay,
  config,
  onDiscountChange,
  isValid,
}: DiscountCellProps) {
  const { t } = useTranslation('payments');
  const [unlocked, setUnlocked] = React.useState(value > 0);

  function commit(discount: number | undefined) {
    // Clamp so `pay + discount ≤ balance` — the server rejects otherwise.
    const clamped = Math.max(0, Math.min(discount ?? 0, balance - pay));
    onDiscountChange(clamped);
  }

  if (!unlocked) {
    return (
      <button
        type="button"
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setUnlocked(true)}
      >
        <LockIcon />
        {value > 0 ? formatCurrency(value, config) : t('record.discount.unlock')}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <MoneyInput
        aria-label={t('record.discount.label')}
        config={config}
        value={value}
        onValueChange={commit}
      />
      <button
        type="button"
        className="text-start text-xs text-primary underline"
        onClick={() => commit(balance - pay)}
      >
        {t('record.discount.discountTheRest')}
      </button>
      {!isValid && (
        <p className="text-xs text-destructive">{t('record.discount.exceedsBalance')}</p>
      )}
    </div>
  );
}

function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V5a3 3 0 0 1 6 0v2" />
    </svg>
  );
}
