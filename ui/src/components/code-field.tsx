/**
 * One-time-code field for two-factor sign-in and setup. ONE `<input>`, not
 * six boxes, so paste and SMS/authenticator autofill work (same reasoning as
 * `OtpInput`). Every string comes in as a prop; the consumer owns the i18n
 * keys.
 *
 * - `variant="totp"` (default): 6 digits. Bangla digits and spaces are
 *   normalised to Latin digits (`toLatinDigits`).
 * - `variant="recovery"`: 16 letters/digits shown in four groups of four
 *   (`ABCD-EFGH-IJKL-MNOP`); `value` and `onComplete` carry them WITHOUT
 *   dashes. Case is left as typed.
 *
 * `onComplete(code)` fires once each time the value becomes full length.
 * Works controlled (`value` + `onValueChange`) or uncontrolled.
 */
import * as React from 'react';

import { cn } from '../primitives/lib/utils';
import { toLatinDigits } from '../utils';

import { Input } from './input';

export type CodeFieldVariant = 'totp' | 'recovery';

export interface CodeFieldProps {
  id: string;
  /** Visible label. */
  label: string;
  variant?: CodeFieldVariant;
  value?: string;
  onValueChange?: (value: string) => void;
  /** Fires with the clean code (no spaces, no dashes) when it reaches full length. */
  onComplete?: (code: string) => void;
  /** Error text under the field; also marks the input invalid. */
  error?: string;
  /** Helper text under the label. */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

const TOTP_LENGTH = 6;
const TOTP_PASTE_ROOM = 12;
const RECOVERY_LENGTH = 16;
// Room to paste a dashed code (16 characters plus 3 dashes) or a spaced one; clean() keeps 16.
const RECOVERY_DISPLAY_LENGTH = 32;

function clean(raw: string, variant: CodeFieldVariant): string {
  if (variant === 'totp') return toLatinDigits(raw).replace(/\D/g, '').slice(0, TOTP_LENGTH);
  return raw.replace(/[^A-Za-z0-9]/g, '').slice(0, RECOVERY_LENGTH);
}

function display(value: string, variant: CodeFieldVariant): string {
  if (variant === 'totp') return value;
  return value.match(/.{1,4}/g)?.join('-') ?? '';
}

export function CodeField({
  id,
  label,
  variant = 'totp',
  value,
  onValueChange,
  onComplete,
  error,
  hint,
  disabled = false,
  className,
}: CodeFieldProps) {
  const [inner, setInner] = React.useState('');
  const current = value ?? inner;
  const length = variant === 'totp' ? TOTP_LENGTH : RECOVERY_LENGTH;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    const next = clean(event.target.value, variant);
    if (value === undefined) setInner(next);
    onValueChange?.(next);
    if (next.length === length && current.length !== length) onComplete?.(next);
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {hint && (
        <p id={hintId} className="text-caption text-text-secondary">
          {hint}
        </p>
      )}
      <Input
        id={id}
        type="text"
        inputMode={variant === 'totp' ? 'numeric' : 'text'}
        autoComplete="one-time-code"
        // Browsers truncate a paste to maxLength BEFORE onChange, so a pasted
        // "123 456" would lose its last digit at maxLength=6. Cleaning to 6
        // digits happens in onChange; this cap only stops runaway typing.
        maxLength={variant === 'totp' ? TOTP_PASTE_ROOM : RECOVERY_DISPLAY_LENGTH}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        value={display(current, variant)}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={handleChange}
      />
      {error && (
        <p id={errorId} role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
