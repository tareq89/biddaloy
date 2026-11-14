/**
 * [100.0.02] One SMS package: name, count, price, validity, one Buy button.
 * Strings only (the caller formats money and numbers). A disabled button
 * explains itself through `disabledReason`, as DocumentCard.unavailable does.
 */
import * as React from 'react';

import { Button } from './button';
import { Card } from './card';

export interface PackageCardProps {
  name: string;
  smsCount: string;
  priceLabel: string;
  validityLabel: string;
  buyLabel: string;
  onBuy: () => void;
  busy?: boolean;
  disabledReason?: string;
  className?: string;
}

export function PackageCard({
  name,
  smsCount,
  priceLabel,
  validityLabel,
  buyLabel,
  onBuy,
  busy = false,
  disabledReason,
  className,
}: PackageCardProps) {
  const id = React.useId();
  const reasonId = `${id}-reason`;
  return (
    <Card padded className={className} role="group" aria-labelledby={`${id}-name`}>
      <h3 id={`${id}-name`} className="text-base font-semibold text-text-primary">
        {name}
      </h3>
      {disabledReason ? (
        <p id={reasonId} className="mt-1 text-caption text-text-secondary">
          {disabledReason}
        </p>
      ) : null}
      <p className="mt-2 text-2xl font-semibold text-text-primary">{smsCount}</p>
      <p className="text-sm text-text-primary">{priceLabel}</p>
      <p className="text-caption text-text-secondary">{validityLabel}</p>
      <Button
        className="mt-4 min-h-11 md:min-h-0"
        onClick={onBuy}
        loading={busy}
        disabled={Boolean(disabledReason)}
        aria-describedby={disabledReason ? reasonId : undefined}
      >
        {buyLabel}
      </Button>
    </Card>
  );
}
