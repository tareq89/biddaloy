/**
 * The one wrapper around `primitives/switch` — an on/off setting that takes
 * effect as a setting (use `Checkbox` for "pick some of these"). Like
 * `Checkbox`, it is the bare control: the accessible name (`aria-label` or an
 * associated `<label htmlFor>`) is the caller's responsibility. A disabled
 * switch keeps its checked look, so a locked "on" setting still reads as on.
 */
import * as React from 'react';

import { Switch as SwitchPrimitive } from '../primitives/switch';

export type SwitchProps = React.ComponentProps<typeof SwitchPrimitive>;

export function Switch(props: SwitchProps) {
  return <SwitchPrimitive {...props} />;
}
