/**
 * Header (name, key identifiers, status badge, primary actions) → tab
 * strip → panel. Built on `primitives/tabs` (Radix) for the WAI-ARIA tab
 * pattern — arrow keys move between tabs, Home/End jump to first/last,
 * roving tabindex — rather than hand-rolled, since Radix already gets
 * this right and DataTable/Calendar's own hand-rolled versions exist only
 * because no Radix primitive covered those cases.
 *
 * **Lazy-load, then stay cached**: Radix's `TabsContent` unmounts inactive
 * panels by default (real Presence unmount, not just CSS-hidden) unless
 * `forceMount` is set, in which case *every* tab mounts immediately
 * regardless of selection — neither is what "lazy, then cached" needs.
 * This component tracks which tabs have ever been selected in local state
 * and only sets `forceMount` for those — a panel mounts the first time
 * its tab is activated, and after that switching away hides it (Radix's
 * own `hidden` attribute) rather than unmounting and losing whatever
 * state/fetched data it holds.
 *
 * Deep-linkable `?tab=` state lives in `useDetailShellTab` (this
 * directory), not here — this component takes `activeTab`/`onTabChange`
 * as plain props, same router-agnostic split as `ListShell`/
 * `useListShellState`.
 *
 * Header actions are tiered per §11 of
 * `docs/architecture/09-design-direction.md`: at most one primary, at
 * most three inline, everything else collapses into an overflow menu.
 */
import { MoreHorizontalIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '../components/button';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '../components/menu';
import { useTranslation } from '../i18n';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/tabs';

export type DetailShellActionPriority = 'primary' | 'secondary' | 'tertiary' | 'destructive';

export interface DetailShellAction {
  id: string;
  label: string;
  onClick: () => void;
  /** Defaults to `true` — set `false` to hide an action the current user
   * doesn't have permission for. Gating happens here, by prop, rather
   * than trusting every call site to have already filtered its own
   * action list. */
  allowed?: boolean;
  /** Which tier of §11's action hierarchy this action occupies. Drives
   * both the `Button` variant and whether it renders inline or inside the
   * overflow menu. Defaults to `'secondary'`, so a call site that has not
   * been migrated can never silently produce a second primary. */
  priority?: DetailShellActionPriority;
}

export interface DetailShellTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

export interface DetailShellProps {
  name: string;
  /** Key identifiers under the name — an ID, a class, a roll number.
   * Plain content, not a fixed shape, since what counts as a "key
   * identifier" is entity-specific. */
  identifiers?: React.ReactNode;
  statusBadge?: React.ReactNode;
  actions?: DetailShellAction[];
  tabs: DetailShellTab[];
  /** Must be one of `tabs[].id` — same contract as Radix `Tabs`' own
   * `value` prop, which this passes straight through. `useDetailShellTab`
   * (this directory) already guarantees this for the common case; a
   * caller wiring its own `activeTab` source is responsible for the same
   * guarantee. */
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export function DetailShell({
  name,
  identifiers,
  statusBadge,
  actions = [],
  tabs,
  activeTab,
  onTabChange,
}: DetailShellProps) {
  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<string>>(
    () => new Set([activeTab]),
  );

  React.useEffect(() => {
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
  }, [activeTab]);

  const visibleActions = actions.filter((action) => action.allowed !== false);

  const { t } = useTranslation();

  const tierOf = (action: DetailShellAction): DetailShellActionPriority =>
    action.priority ?? 'secondary';

  const primary = visibleActions.filter((a) => tierOf(a) === 'primary');
  const secondary = visibleActions.filter((a) => tierOf(a) === 'secondary');
  const tertiary = visibleActions.filter((a) => tierOf(a) === 'tertiary');
  const destructive = visibleActions.filter((a) => tierOf(a) === 'destructive');

  // Rule 4: a lone destructive action with nothing else to share a menu
  // with stays inline. Burying a single "Delete" behind a menu costs a
  // click and buys nothing.
  const destructiveInline = tertiary.length === 0 ? destructive : [];
  const destructiveInMenu = tertiary.length === 0 ? [] : destructive;
  const menuActions = [...tertiary, ...destructiveInMenu];

  // Secondaries first, primary right-most. `flex` follows the logical
  // direction, so this mirrors correctly under RTL without extra work.
  const inlineActions = [...secondary, ...destructiveInline, ...primary];

  if (process.env.NODE_ENV !== 'production' && primary.length > 1) {
    // Not a thrown error: permission gating must never crash a page.
    console.warn(
      `DetailShell: ${primary.length} actions declared priority "primary" (${primary
        .map((a) => a.id)
        .join(', ')}). Design contract §11 allows at most one.`,
    );
  }

  const variantFor = (action: DetailShellAction) =>
    tierOf(action) === 'primary'
      ? ('default' as const)
      : tierOf(action) === 'destructive'
        ? ('destructive' as const)
        : ('outline' as const);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">{name}</h1>
            {statusBadge}
          </div>
          {identifiers && <div className="text-sm text-muted-foreground">{identifiers}</div>}
        </div>
        {(inlineActions.length > 0 || menuActions.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {inlineActions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant={variantFor(action)}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
            {menuActions.length > 0 && (
              <Menu>
                <MenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    iconOnly
                    aria-label={t('actions.moreActions')}
                  >
                    <MoreHorizontalIcon />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end">
                  {tertiary.map((action) => (
                    <MenuItem key={action.id} onSelect={action.onClick}>
                      {action.label}
                    </MenuItem>
                  ))}
                  {destructiveInMenu.length > 0 && tertiary.length > 0 && <MenuSeparator />}
                  {destructiveInMenu.map((action) => (
                    <MenuItem key={action.id} variant="destructive" onSelect={action.onClick}>
                      {action.label}
                    </MenuItem>
                  ))}
                </MenuContent>
              </Menu>
            )}
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange}>
        {/* [8.14.7] Wraps onto extra rows at narrow widths instead of
            scrolling in its own container — `expectNoInnerHorizontalScroll`
            now treats any inner scroll region, not just DataTable's old one,
            as a phone-usability defect. Each trigger drops the list's
            equal-width `flex-1` (which would force overflow instead of
            wrapping) and fixes its own height, since the list's height
            token no longer bounds a single row once it can wrap to more
            than one. */}
        <TabsList className="h-auto max-w-full flex-wrap gap-1">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="h-[calc(var(--control-h,2rem)-1px)] flex-none grow-0 basis-auto"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {tabs.map((tab) => {
          const visited = visitedTabs.has(tab.id);
          return (
            <TabsContent key={tab.id} value={tab.id} {...(visited ? { forceMount: true } : {})}>
              {visited ? tab.content : null}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
