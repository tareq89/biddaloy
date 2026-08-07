/**
 * The one wrapper around `primitives/radio-group`. `RadioGroup` needs an
 * accessible name of its own (`aria-label`/`aria-labelledby` on the group,
 * not just on each item) — `FormField` ([8.6.3]) supplies that via
 * `<fieldset>`/`<legend>` when composing this into a real form field.
 */
import * as React from 'react';

import {
  RadioGroup as RadioGroupPrimitive,
  RadioGroupItem as RadioGroupItemPrimitive,
} from '../primitives/radio-group';

export type RadioGroupProps = React.ComponentProps<typeof RadioGroupPrimitive>;
export type RadioGroupItemProps = React.ComponentProps<typeof RadioGroupItemPrimitive>;

export function RadioGroup(props: RadioGroupProps) {
  return <RadioGroupPrimitive {...props} />;
}

export function RadioGroupItem(props: RadioGroupItemProps) {
  return <RadioGroupItemPrimitive {...props} />;
}
