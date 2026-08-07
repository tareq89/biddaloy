/**
 * An `Input` that validates against `config.phone.pattern` on every
 * keystroke and shows the region's own example (`config.phone.example`) as
 * a placeholder — a Bangladeshi user sees `1712-345678`, not a generic
 * `(555) 123-4567` that means nothing for their number's shape.
 */
import * as React from 'react';

import type { RegionConfig } from '../i18n/region-config';
import { formatPhone, parsePhone } from '../utils/phone';

import { Input } from './input';

export interface PhoneInputProps extends Omit<
  React.ComponentProps<typeof Input>,
  'onChange' | 'value' | 'type' | 'placeholder'
> {
  /** The raw national number as typed, or the last valid value. */
  value: string;
  onValueChange: (value: string, valid: boolean) => void;
  config: RegionConfig;
}

export function PhoneInput({ value, onValueChange, config, ...props }: PhoneInputProps) {
  return (
    <Input
      {...props}
      type="tel"
      inputMode="tel"
      placeholder={config.phone.example}
      value={value}
      aria-invalid={value !== '' && !parsePhone(value, config).valid}
      onChange={(event) => {
        const raw = event.target.value;
        const result = parsePhone(raw, config);
        onValueChange(raw, result.valid);
      }}
    />
  );
}

/** Formats an already-valid national number for display — e.g. read-only
 * contexts (a review step, a details panel) rather than the live-editing
 * `PhoneInput` above. */
export function formatValidPhone(nationalNumber: string, config: RegionConfig): string {
  return formatPhone(nationalNumber, config);
}
