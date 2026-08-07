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

export function MoneyInput({
  value,
  onValueChange,
  config,
  onBlur,
  onFocus,
  ...props
}: MoneyInputProps) {
  const [text, setText] = React.useState(() =>
    value === undefined ? '' : formatCurrency(value, config),
  );
  const [hasParseError, setHasParseError] = React.useState(false);
  const isFocusedRef = React.useRef(false);

  // Not an unconditional `useEffect` re-syncing `text` from `value` on
  // every change: `onChange` below calls `onValueChange` on every valid
  // keystroke, which is exactly what makes this a controlled component —
  // but re-deriving `text` from that same `value` on every render would
  // immediately overwrite whatever the user is mid-typing with the fully
  // formatted amount, corrupting input like "500" into "5.00" one
  // keystroke behind. Guarding on focus fixes that without giving up on
  // the controlled contract entirely: while focused, this is a no-op (own
  // typing keeps working exactly as before); once blurred, an external
  // change to `value` — `form.reset()`, a sibling field clearing this one
  // — reaches the display the same way it would for any other controlled
  // input, instead of being stuck until the user happens to refocus it.
  React.useEffect(() => {
    if (isFocusedRef.current) return;
    setText(value === undefined ? '' : formatCurrency(value, config));
  }, [value, config]);

  return (
    <Input
      {...props}
      inputMode="decimal"
      value={text}
      aria-invalid={hasParseError || props['aria-invalid']}
      onFocus={(event) => {
        isFocusedRef.current = true;
        onFocus?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        setHasParseError(false);
        if (raw.trim() === '') {
          onValueChange(undefined);
          return;
        }
        try {
          onValueChange(parseCurrency(raw, config));
        } catch {
          // Interim typing state ("1,2" mid-keystroke) isn't a valid
          // amount yet — leave the last committed value alone rather than
          // clobbering it with `undefined`; resolved on blur below, either
          // by reformatting (valid) or flagging (still invalid).
        }
      }}
      onBlur={(event) => {
        isFocusedRef.current = false;
        onBlur?.(event);
        if (text.trim() === '') {
          setHasParseError(false);
          return;
        }
        try {
          parseCurrency(text, config);
          setHasParseError(false);
          setText(value === undefined ? '' : formatCurrency(value, config));
        } catch {
          // A genuinely invalid amount ("12.", "abc") was left behind by
          // the last keystroke. Flag it locally (`aria-invalid`) and leave
          // it on screen rather than silently reverting to the last good
          // `value` — that revert previously destroyed what the user typed
          // with no signal anything was wrong. Full form-state integration
          // (surfacing this through FormField/Zod, not just locally) needs
          // a new prop this component doesn't have yet — out of scope here.
          setHasParseError(true);
        }
      }}
    />
  );
}
