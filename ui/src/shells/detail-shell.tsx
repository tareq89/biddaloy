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
 */
import * as React from 'react';

import { Button } from '../components/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/tabs';

export interface DetailShellAction {
  id: string;
  label: string;
  onClick: () => void;
  /** Defaults to `true` — set `false` to hide an action the current user
   * doesn't have permission for. Gating happens here, by prop, rather
   * than trusting every call site to have already filtered its own
   * action list. */
  allowed?: boolean;
  variant?: React.ComponentProps<typeof Button>['variant'];
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
        {visibleActions.length > 0 && (
          <div className="flex gap-1.5">
            {visibleActions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant={action.variant}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
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
