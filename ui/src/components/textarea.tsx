/**
 * The one wrapper around `primitives/textarea`. Like `Input`, this is the
 * bare control — an accessible name (`aria-label` or an associated
 * `<label>`) is the caller's responsibility until `FormField` ([8.6.3])
 * composes this with a real label element.
 */
import * as React from 'react';

import { Textarea as TextareaPrimitive } from '../primitives/textarea';

export type TextareaProps = React.ComponentProps<typeof TextareaPrimitive>;

export function Textarea(props: TextareaProps) {
  return <TextareaPrimitive {...props} />;
}
