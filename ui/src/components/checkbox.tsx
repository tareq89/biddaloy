/**
 * The one wrapper around `primitives/checkbox`. Like `Input`, this is the
 * bare control — an accessible name (`aria-label` or an associated
 * `<label>`) is the caller's responsibility until `FormField` ([8.6.3])
 * composes this with a real label element.
 */
import * as React from 'react';

import { Checkbox as CheckboxPrimitive } from '@/primitives/checkbox';

export type CheckboxProps = React.ComponentProps<typeof CheckboxPrimitive>;

export function Checkbox(props: CheckboxProps) {
  return <CheckboxPrimitive {...props} />;
}
