/**
 * The one wrapper around `primitives/select`. Composable, matching Radix's
 * own `Select`/`SelectTrigger`/`SelectContent`/`SelectItem` shape — the
 * accessible name comes from an associated `<label>` (or `aria-label` on
 * `SelectTrigger`), which `FormField` ([8.6.3]) supplies when it composes
 * this into a real form field. `Combobox` ([8.6.3]) is the async/searchable
 * sibling for large option lists; this one is for a short, static list.
 */
import * as React from 'react';

import {
  Select as SelectPrimitive,
  SelectContent as SelectContentPrimitive,
  SelectGroup as SelectGroupPrimitive,
  SelectItem as SelectItemPrimitive,
  SelectLabel as SelectLabelPrimitive,
  SelectSeparator as SelectSeparatorPrimitive,
  SelectTrigger as SelectTriggerPrimitive,
  SelectValue as SelectValuePrimitive,
} from '@/primitives/select';

export type SelectProps = React.ComponentProps<typeof SelectPrimitive>;
export type SelectTriggerProps = React.ComponentProps<typeof SelectTriggerPrimitive>;
export type SelectContentProps = React.ComponentProps<typeof SelectContentPrimitive>;
export type SelectItemProps = React.ComponentProps<typeof SelectItemPrimitive>;
export type SelectValueProps = React.ComponentProps<typeof SelectValuePrimitive>;
export type SelectGroupProps = React.ComponentProps<typeof SelectGroupPrimitive>;
export type SelectLabelProps = React.ComponentProps<typeof SelectLabelPrimitive>;
export type SelectSeparatorProps = React.ComponentProps<typeof SelectSeparatorPrimitive>;

export function Select(props: SelectProps) {
  return <SelectPrimitive {...props} />;
}

export function SelectTrigger(props: SelectTriggerProps) {
  return <SelectTriggerPrimitive {...props} />;
}

export function SelectContent(props: SelectContentProps) {
  return <SelectContentPrimitive {...props} />;
}

export function SelectItem(props: SelectItemProps) {
  return <SelectItemPrimitive {...props} />;
}

export function SelectValue(props: SelectValueProps) {
  return <SelectValuePrimitive {...props} />;
}

export function SelectGroup(props: SelectGroupProps) {
  return <SelectGroupPrimitive {...props} />;
}

export function SelectLabel(props: SelectLabelProps) {
  return <SelectLabelPrimitive {...props} />;
}

export function SelectSeparator(props: SelectSeparatorProps) {
  return <SelectSeparatorPrimitive {...props} />;
}
