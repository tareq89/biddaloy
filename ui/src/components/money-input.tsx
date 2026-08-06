/**
 * An `Input` that speaks money, not text — always displays the fully
 * formatted amount (currency symbol, lakh/crore or thousand grouping, the
 * configured numeral system), and accepts free-typed input in **either**
 * digit system (`parseCurrency` handles both) without the caller doing any
 * conversion. `value`/`onValueChange` are integer minor units (paisa),
 * never a float — the same contract `formatCurrency`/`parseCurrency`
 * establish, for the same reason (see `utils/currency.ts`'s header
 * comment).
 */
import * as React from 'react';

import { formatCurrency, parseCurrency } from '../utils/currency';
import type { RegionConfig } from '../utils/region-config';

import { Input } from './input';

export interface MoneyInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  'onChange' | 'value' | 'type' | 'inputMode'
> {
  /** Integer minor units (paisa) — `undefined` for an empty field. */
  value: number | undefined;
  onValueChange: (minorUnits: number | undefined) => void;
  config: RegionConfig;
}

export function MoneyInput({ value, onValueChange, config, onBlur, ...props }: MoneyInputProps) {
  const [text, setText] = React.useState(() =>
    value === undefined ? '' : formatCurrency(value, config),
  );

  // Deliberately *not* a `useEffect` re-syncing `text` from `value` on
  // every change: `onChange` below calls `onValueChange` on every valid
  // keystroke, which is exactly what makes this a controlled component —
  // but re-deriving `text` from that same `value` on every render would
  // immediately overwrite whatever the user is mid-typing with the fully
  // formatted amount, corrupting input like "500" into "5.00" one
  // keystroke behind. Reformatting only happens on blur (below) and on
  // mount (the lazy initializer above); an external, non-focus-driven
  // reset of `value` while this input isn't focused won't retroactively
  // reformat `text` until the next blur — an accepted gap for this ticket,
  // not something FormField's own reset flow currently exercises.
  return (
    <Input
      {...props}
      inputMode="decimal"
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        if (raw.trim() === '') {
          onValueChange(undefined);
          return;
        }
        try {
          onValueChange(parseCurrency(raw, config));
        } catch {
          // Interim typing state ("1,2" mid-keystroke) isn't a valid
          // amount yet — leave the last committed value alone rather than
          // clobbering it with `undefined`; the caller's own validation
          // (FormField/Zod) surfaces the eventual error, not this input.
        }
      }}
      onBlur={(event) => {
        onBlur?.(event);
        setText(value === undefined ? '' : formatCurrency(value, config));
      }}
    />
  );
}
