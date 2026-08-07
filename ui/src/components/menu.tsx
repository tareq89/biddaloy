/**
 * The one wrapper around `primitives/dropdown-menu`, renamed to `Menu` to
 * match this package's own vocabulary (the issue calls it `Menu`, not
 * `DropdownMenu`) — Radix's own WAI-ARIA menu pattern (arrow-key
 * navigation, typeahead, `Esc` to close, focus return to the trigger) is
 * unchanged underneath.
 */
import * as React from 'react';

import {
  DropdownMenu as MenuPrimitive,
  DropdownMenuCheckboxItem as MenuCheckboxItemPrimitive,
  DropdownMenuContent as MenuContentPrimitive,
  DropdownMenuGroup as MenuGroupPrimitive,
  DropdownMenuItem as MenuItemPrimitive,
  DropdownMenuLabel as MenuLabelPrimitive,
  DropdownMenuRadioGroup as MenuRadioGroupPrimitive,
  DropdownMenuRadioItem as MenuRadioItemPrimitive,
  DropdownMenuSeparator as MenuSeparatorPrimitive,
  DropdownMenuShortcut as MenuShortcutPrimitive,
  DropdownMenuSub as MenuSubPrimitive,
  DropdownMenuSubContent as MenuSubContentPrimitive,
  DropdownMenuSubTrigger as MenuSubTriggerPrimitive,
  DropdownMenuTrigger as MenuTriggerPrimitive,
} from '../primitives/dropdown-menu';

export type MenuProps = React.ComponentProps<typeof MenuPrimitive>;
export type MenuTriggerProps = React.ComponentProps<typeof MenuTriggerPrimitive>;
export type MenuContentProps = React.ComponentProps<typeof MenuContentPrimitive>;
export type MenuItemProps = React.ComponentProps<typeof MenuItemPrimitive>;
export type MenuCheckboxItemProps = React.ComponentProps<typeof MenuCheckboxItemPrimitive>;
export type MenuRadioGroupProps = React.ComponentProps<typeof MenuRadioGroupPrimitive>;
export type MenuRadioItemProps = React.ComponentProps<typeof MenuRadioItemPrimitive>;
export type MenuLabelProps = React.ComponentProps<typeof MenuLabelPrimitive>;
export type MenuSeparatorProps = React.ComponentProps<typeof MenuSeparatorPrimitive>;
export type MenuShortcutProps = React.ComponentProps<typeof MenuShortcutPrimitive>;
export type MenuGroupProps = React.ComponentProps<typeof MenuGroupPrimitive>;
export type MenuSubProps = React.ComponentProps<typeof MenuSubPrimitive>;
export type MenuSubTriggerProps = React.ComponentProps<typeof MenuSubTriggerPrimitive>;
export type MenuSubContentProps = React.ComponentProps<typeof MenuSubContentPrimitive>;

export function Menu(props: MenuProps) {
  return <MenuPrimitive {...props} />;
}

export function MenuTrigger(props: MenuTriggerProps) {
  return <MenuTriggerPrimitive {...props} />;
}

export function MenuContent(props: MenuContentProps) {
  return <MenuContentPrimitive {...props} />;
}

export function MenuItem(props: MenuItemProps) {
  return <MenuItemPrimitive {...props} />;
}

export function MenuCheckboxItem(props: MenuCheckboxItemProps) {
  return <MenuCheckboxItemPrimitive {...props} />;
}

export function MenuRadioGroup(props: MenuRadioGroupProps) {
  return <MenuRadioGroupPrimitive {...props} />;
}

export function MenuRadioItem(props: MenuRadioItemProps) {
  return <MenuRadioItemPrimitive {...props} />;
}

export function MenuLabel(props: MenuLabelProps) {
  return <MenuLabelPrimitive {...props} />;
}

export function MenuSeparator(props: MenuSeparatorProps) {
  return <MenuSeparatorPrimitive {...props} />;
}

export function MenuShortcut(props: MenuShortcutProps) {
  return <MenuShortcutPrimitive {...props} />;
}

export function MenuGroup(props: MenuGroupProps) {
  return <MenuGroupPrimitive {...props} />;
}

export function MenuSub(props: MenuSubProps) {
  return <MenuSubPrimitive {...props} />;
}

export function MenuSubTrigger(props: MenuSubTriggerProps) {
  return <MenuSubTriggerPrimitive {...props} />;
}

export function MenuSubContent(props: MenuSubContentProps) {
  return <MenuSubContentPrimitive {...props} />;
}
