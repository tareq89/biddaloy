/**
 * The one wrapper around `primitives/input`. Thin today — labelling,
 * error linking (`aria-invalid`/`aria-describedby`) and validation wiring
 * belong to `FormField` ([8.6.3]), which composes this. A bare `Input`
 * used outside `FormField` still needs its own accessible name (`aria-label`
 * or an associated `<label htmlFor>`) — this wrapper can't supply one on
 * your behalf without knowing what the field is for.
 */
import * as React from 'react';

import { Input as InputPrimitive } from '@/primitives/input';

export type InputProps = React.ComponentProps<typeof InputPrimitive>;

export function Input(props: InputProps) {
  return <InputPrimitive {...props} />;
}
