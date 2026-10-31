/**
 * The one wrapper around `primitives/label`. Mostly used indirectly via
 * `FormField`'s `FormLabel`, which sets `htmlFor` for you — reach for this
 * directly only outside a `FormField` (e.g. labelling a `RadioGroup` as a
 * whole via `aria-labelledby`, not any single control within it).
 *
 * `helpId` adds a (?) beside the label (Epic 44). It is a sibling of the
 * `<label>`, so clicking the label still focuses its control, and the (?) is
 * named after the label text. No wrapper renders unless the hint resolves.
 */
import * as React from 'react';

import { Label as LabelPrimitive } from '../primitives/label';

import { HelpHint, useHelp } from './help-hint';

export type LabelProps = React.ComponentProps<typeof LabelPrimitive> & {
  helpId?: string | undefined;
  /** Names the (?) when the children are not plain text. Defaults to the children. */
  helpLabel?: string | undefined;
  /** Classes on the (?) button (e.g. hide it with a label that is hidden on phones). */
  helpClassName?: string | undefined;
};

export function Label({ helpId, helpLabel, helpClassName, ...props }: LabelProps) {
  const { resolve } = useHelp();
  const label = <LabelPrimitive {...props} />;
  if (!resolve(helpId)) return label;
  const text = helpLabel ?? (typeof props.children === 'string' ? props.children : undefined);
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <HelpHint helpId={helpId} label={text} className={helpClassName} />
    </span>
  );
}
