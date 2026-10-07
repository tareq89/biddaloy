/**
 * [16.4.4] CASH-only tender: amount tendered, computed change, and the
 * RETURN/TO_WALLET choice for that change. C7's invariant change formula
 * (the two forms #659's body gives are internally inconsistent — see the
 * published plan's own correction): `change = wallet_use + tendered −
 * Σ lines.amount`, floored at 0. All arithmetic in integer minor units.
 */
import { Label, MoneyInput, RadioGroup, RadioGroupItem } from '@biddaloy/ui/components';
import type { ChangeHandling } from '@biddaloy/ui/hooks';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';
import * as React from 'react';

import { optionRowClass } from './option-row';

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
  const tenderedId = React.useId();
  const changeLegendId = React.useId();
  const tendered = tenderedMinorUnits ?? 0;
  const rawChange = walletUseMinorUnits + tendered - subtotalMinorUnits;
  const changeMinorUnits = Math.max(0, rawChange);
  const isInvalid = tenderedMinorUnits !== undefined && rawChange < 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={tenderedId}>{t('record.tender.tenderedLabel')}</Label>
          <MoneyInput
            id={tenderedId}
            config={config}
            value={tenderedMinorUnits}
            onValueChange={onTenderedChange}
            aria-invalid={isInvalid}
          />
          <p className="text-label text-text-secondary">{t('record.tender.hint')}</p>
          {isInvalid && (
            <p className="text-sm text-destructive">{t('record.tender.tenderTooLow')}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('record.tender.changeLabel')}</span>
          <div className="flex h-11 items-center rounded-md bg-status-due-bg px-3 text-h3 text-status-due-fg tabular-nums md:h-8">
            {formatCurrency(changeMinorUnits, config)}
          </div>
        </div>
      </div>

      {changeMinorUnits > 0 && (
        <div className="flex flex-col gap-2">
          <span id={changeLegendId} className="text-sm font-medium">
            {t('record.changeHandlingLabel')}
          </span>
          <RadioGroup
            value={changeHandling}
            onValueChange={(value) => onChangeHandlingChange(value as ChangeHandling)}
            aria-labelledby={changeLegendId}
            className="grid gap-2 md:grid-cols-2"
          >
            <label className={optionRowClass}>
              <RadioGroupItem value="RETURN" />
              {t('record.tender.changeReturn')}
            </label>
            <label className={optionRowClass}>
              <RadioGroupItem value="TO_WALLET" />
              {t('record.tender.changeToWallet')}
            </label>
          </RadioGroup>
        </div>
      )}
    </div>
  );
}
