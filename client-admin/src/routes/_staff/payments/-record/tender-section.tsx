/**
 * [16.4.4] CASH-only tender: amount tendered, computed change, and the
 * RETURN/TO_WALLET choice for that change. C7's invariant change formula
 * (the two forms #659's body gives are internally inconsistent — see the
 * published plan's own correction): `change = wallet_use + tendered −
 * Σ lines.amount`, floored at 0. All arithmetic in integer minor units.
 */
import { MoneyInput, RadioGroup, RadioGroupItem } from '@biddaloy/ui/components';
import type { ChangeHandling } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';

export interface TenderSectionProps {
  config: RegionConfig;
  tenderedMinorUnits: number | undefined;
  onTenderedChange: (value: number | undefined) => void;
  walletUseMinorUnits: number;
  /** F16: this is the cart's `subtotal`, NOT the modal's own
   * `amountDueMinorUnits` (which is `subtotal - wallet`) — the change
   * formula below already subtracts `walletUseMinorUnits` itself, so
   * feeding it the wallet-net figure would double-count the wallet
   * credit. Named for what it actually is to stop a future "fix" from
   * swapping in the wrong variable. */
  subtotalMinorUnits: number;
  changeHandling: ChangeHandling;
  onChangeHandlingChange: (value: ChangeHandling) => void;
}

export function TenderSection({
  config,
  tenderedMinorUnits,
  onTenderedChange,
  walletUseMinorUnits,
  subtotalMinorUnits,
  changeHandling,
  onChangeHandlingChange,
}: TenderSectionProps) {
  const { t } = useTranslation('payments');
  const tendered = tenderedMinorUnits ?? 0;
  const rawChange = walletUseMinorUnits + tendered - subtotalMinorUnits;
  const changeMinorUnits = Math.max(0, rawChange);
  const isInvalid = tenderedMinorUnits !== undefined && rawChange < 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">{t('record.tender.tenderedLabel')}</span>
        <MoneyInput
          aria-label={t('record.tender.tenderedLabel')}
          config={config}
          value={tenderedMinorUnits}
          onValueChange={onTenderedChange}
          aria-invalid={isInvalid}
        />
        {isInvalid && <p className="text-sm text-destructive">{t('record.tender.tenderTooLow')}</p>}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{t('record.tender.changeLabel')}</span>
        <span className="font-medium">{formatCurrency(changeMinorUnits, config)}</span>
      </div>

      {changeMinorUnits > 0 && (
        <RadioGroup
          value={changeHandling}
          onValueChange={(value) => onChangeHandlingChange(value as ChangeHandling)}
          className="flex gap-4"
        >
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="RETURN" />
            {t('record.tender.changeReturn')}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <RadioGroupItem value="TO_WALLET" />
            {t('record.tender.changeToWallet')}
          </label>
        </RadioGroup>
      )}
    </div>
  );
}
