/**
 * [16.4.4] A `MoneyInput` that stays visually locked (a lock icon,
 * `readOnly`) until the accountant clicks it — discounting a bill is
 * rare enough, and consequential enough (it triggers a step-up approval
 * prompt on submit — see `record-payment-modal.tsx`'s `useCheckout()`),
 * that it shouldn't be one accidental keystroke away from the Pay column
 * next to it.
 */
import { Button, MoneyInput } from '@biddaloy/ui/components';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';
import { Lock } from 'lucide-react';
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
  /** Row identity (fee + period) appended to the accessible names so every row is unique. */
  rowName?: string;
}

export function DiscountCell({
  value,
  balance,
  pay,
  config,
  onDiscountChange,
  isValid,
  rowName,
}: DiscountCellProps) {
  const { t } = useTranslation('payments');
  const suffix = rowName ? ` — ${rowName}` : '';
  const [unlocked, setUnlocked] = React.useState(value > 0);

  function commit(discount: number | undefined) {
    // Clamp so `pay + discount ≤ balance` — the server rejects otherwise.
    const clamped = Math.max(0, Math.min(discount ?? 0, balance - pay));
    onDiscountChange(clamped);
  }

  if (!unlocked) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="h-11 justify-start gap-1.5 px-2 text-label font-medium text-text-secondary md:h-8"
        aria-label={`${value > 0 ? formatCurrency(value, config) : t('record.discount.give')}${suffix}`}
        onClick={() => setUnlocked(true)}
      >
        <Lock className="size-4" aria-hidden="true" />
        {value > 0 ? formatCurrency(value, config) : t('record.discount.give')}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <MoneyInput
        aria-label={`${t('record.discount.label')}${suffix}`}
        config={config}
        value={value}
        onValueChange={commit}
      />
      <Button
        type="button"
        variant="ghost"
        className="h-11 justify-start px-2 text-label text-primary md:h-8"
        onClick={() => commit(balance - pay)}
      >
        {t('record.discount.discountTheRest')}
      </Button>
      {!isValid && (
        <p className="text-xs text-destructive">{t('record.discount.exceedsBalance')}</p>
      )}
    </div>
  );
}
