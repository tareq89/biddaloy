/**
 * [77.3 / #3921] One place a client surface asks "is this module on?" (D16, D37).
 * Every tab, portal card, dashboard widget and report link carries a `module`:
 * a `ModuleKey`, or `'core'` for the areas that are never off (D6). The answer
 * comes from `useModuleEnabled` only; the server stays the authority (D27).
 */
import { ModuleKey } from '@biddaloy/shared';
import { useModuleEnabled } from '@biddaloy/ui/hooks';
import * as React from 'react';

export type Gated = ModuleKey | 'core';

const KEYS = Object.values(ModuleKey);

/** `(module) => on`, one hook call per key. `KEYS` is a constant, so hook order never changes. */
export function useModuleGate(): (module: Gated) => boolean {
  /* eslint-disable react-hooks/rules-of-hooks -- constant list, stable order */
  const flags = KEYS.map((key) => useModuleEnabled(key));
  /* eslint-enable react-hooks/rules-of-hooks */
  const sig = flags.join();
  // Same answer, same function: callers can keep it in a memo's deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `sig` is `flags`
  return React.useMemo(() => (module) => module === 'core' || flags[KEYS.indexOf(module)]!, [sig]);
}

/** Drops the tabs of an off module (no empty tab left behind, D41) and strips `module`. */
// `module: string` because a conditional spread (`...(can ? [{...}] : [])`) widens the literal;
// the coverage test checks every value is a real `ModuleKey` or `'core'`.
export function gateTabs<T extends { module: string }>(
  tabs: readonly T[],
  isOn: (module: Gated) => boolean,
): Omit<T, 'module'>[] {
  return tabs
    .filter((t) => isOn(t.module as Gated))
    .map(({ module, ...rest }) => (void module, rest));
}

/** A deep link to a tab that is now hidden lands on the first tab left. */
export function visibleTab(tabs: readonly { id: string }[], active: string): string {
  return tabs.some((t) => t.id === active) ? active : (tabs[0]?.id ?? active);
}
