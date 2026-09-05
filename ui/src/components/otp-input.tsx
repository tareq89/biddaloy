/**
 * 12.4's one-time-code field for the `/forgot-password` "code" step. One
 * `Input`, not six separate boxes — a six-box grid means six focus targets,
 * six ids to manage, and reimplementing paste-splitting; a single field
 * with `inputMode="numeric"` and `autoComplete="one-time-code"` gets the
 * platform's own SMS-autofill affordance for free and is trivially keyboard-
 * and screen-reader-operable.
 *
 * `toLatinDigits` (`ui/src/utils/digits.ts`) runs on every keystroke so a
 * Bengali-numeral keyboard (০-৯) works exactly like a Latin one — the same
 * normalization layer [8.13.x]/#372 already established for money/phone
 * input. Anything left over that isn't a digit is stripped, so a pasted
 * "123 456" or "123-456" still lands as "123456".
 */
import { toLatinDigits } from '../utils';

import { Input } from './input';

export interface OtpInputProps {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  /** No visible `<label>` in the caller's layout (the `/forgot-password`
   * "code" step uses a heading instead) — required rather than optional so
   * every usage stays accessible by name. */
  'aria-label': string;
}

const OTP_LENGTH = 6;

export function OtpInput({
  id,
  value,
  onValueChange,
  disabled = false,
  invalid = false,
  'aria-label': ariaLabel,
}: OtpInputProps) {
  return (
    <Input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={OTP_LENGTH}
      value={value}
      disabled={disabled}
      aria-invalid={invalid}
      aria-label={ariaLabel}
      onChange={(event) => {
        const normalized = toLatinDigits(event.target.value).replace(/\D/g, '');
        onValueChange(normalized.slice(0, OTP_LENGTH));
      }}
    />
  );
}
