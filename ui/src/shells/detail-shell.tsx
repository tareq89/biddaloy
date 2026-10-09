/**
 * Header (name, status badge, facts, actions) → tab strip → panel. Built on
 * `primitives/tabs` (Radix) for the WAI-ARIA tab pattern — arrow keys move
 * between tabs, Home/End jump to first/last, roving tabindex.
 *
 * **Lazy-load, then stay cached, one panel visible**: a panel mounts the
 * first time its tab is activated. After that it gets `forceMount` (so it is
 * never unmounted and keeps its local state) and the native `hidden`
 * attribute while inactive. `forceMount` alone makes Radix think every
 * visited panel is present, so they would all show (B1); our own `hidden`
 * wins because Radix spreads caller props after its own.
 *
 * `tabs` is optional: a detail page without tabs passes `children` instead.
 *
 * Deep-linkable `?tab=` state lives in `useDetailShellTab`, not here.
 * Actions follow the PageHeader rules (`PageHeaderActions`).
 */
import * as React from 'react';

import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/tabs';

import { PageContainer } from './page-container';
import { PageHeaderActions, type PageAction, type PageActionPriority } from './page-header';

export type DetailShellActionPriority = PageActionPriority;
export type DetailShellAction = PageAction;

export interface DetailShellTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

export interface DetailShellProps {
  name: string;
  /** Key identifiers under the name — an ID, a class, a roll number.
   * Plain content, not a fixed shape, since what counts as a "key
   * identifier" is entity-specific.
   * @deprecated — use `facts`. */
  identifiers?: React.ReactNode;
  /** Labelled key facts under the name, shown as `dt`/`dd` pairs. */
  facts?: { label: string; value: React.ReactNode }[];
  statusBadge?: React.ReactNode;
  actions?: DetailShellAction[];
  /** Absent or empty: no tab row, `children` is the body. */
  tabs?: DetailShellTab[];
  /** Body when there are no tabs. Ignored when `tabs` is non-empty. */
  children?: React.ReactNode;
  /** Must be one of `tabs[].id` — same contract as Radix `Tabs`' own
   * `value` prop, which this passes straight through. `useDetailShellTab`
   * (this directory) already guarantees this for the common case; a
   * caller wiring its own `activeTab` source is responsible for the same
   * guarantee. */
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
}

export function DetailShell({
  name,
  identifiers,
  facts,
  statusBadge,
  actions = [],
  tabs = [],
  children,
  activeTab,
  onTabChange,
}: DetailShellProps) {
  const hasTabs = tabs.length > 0;
  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<string>>(
    () => new Set(activeTab ? [activeTab] : []),
  );
  const triggerRefs = React.useRef(new Map<string, HTMLButtonElement>());

  React.useEffect(() => {
    if (!activeTab) return;
    setVisitedTabs((prev) => (prev.has(activeTab) ? prev : new Set(prev).add(activeTab)));
    // jsdom has no scrollIntoView, hence `?.`.
    triggerRefs.current.get(activeTab)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeTab]);

  if (process.env.NODE_ENV !== 'production' && hasTabs && (!activeTab || !onTabChange)) {
    console.warn('DetailShell: `activeTab` and `onTabChange` are required when `tabs` is set.');
  }

  return (
    <PageContainer size="wide">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between md:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-h1">{name}</h1>
            {statusBadge}
          </div>
          {identifiers && <div className="mt-1 text-text-secondary">{identifiers}</div>}
          {facts && facts.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 md:flex md:flex-wrap">
              {facts.map((fact) => (
                <div key={fact.label}>
                  <dt className="text-caption text-text-secondary">{fact.label}</dt>
                  <dd className="font-medium">{fact.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        <PageHeaderActions actions={actions} />
      </header>

      {hasTabs ? (
        <Tabs value={activeTab ?? ''} onValueChange={(v) => onTabChange?.(v)}>
          <div className="relative">
            <TabsList variant="line">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  ref={(el) => {
                    if (el) triggerRefs.current.set(tab.id, el);
                    else triggerRefs.current.delete(tab.id);
                  }}
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {/* ponytail: fade always drawn; add a scroll-width check only if it ever covers a tab. */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 end-0 w-12 bg-linear-to-l from-bg to-transparent rtl:bg-linear-to-r"
            />
          </div>
          {tabs.map((tab) => {
            const visited = visitedTabs.has(tab.id);
            return (
              <TabsContent
                key={tab.id}
                value={tab.id}
                {...(visited ? { forceMount: true } : {})}
                hidden={tab.id !== activeTab}
              >
                {visited ? tab.content : null}
              </TabsContent>
            );
          })}
        </Tabs>
      ) : (
        children
      )}
    </PageContainer>
  );
}
