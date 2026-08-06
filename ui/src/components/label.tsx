/**
 * The one wrapper around `primitives/label`. Mostly used indirectly via
 * `FormField`'s `FormLabel`, which sets `htmlFor` for you — reach for this
 * directly only outside a `FormField` (e.g. labelling a `RadioGroup` as a
 * whole via `aria-labelledby`, not any single control within it).
 */
import * as React from 'react';

import { Label as LabelPrimitive } from '../primitives/label';

export type LabelProps = React.ComponentProps<typeof LabelPrimitive>;

export function Label(props: LabelProps) {
  return <LabelPrimitive {...props} />;
}
