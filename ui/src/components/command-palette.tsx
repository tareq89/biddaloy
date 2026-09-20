/**
 * [30.4.1] `Ctrl/Cmd+K` command palette — `docs/architecture/15-ux-principles.md`
 * §4. Generalises `global-search.tsx`'s single-list `GlobalSearch` into
 * three tabs (**People · Page · Action**) without touching any of the
 * accessibility decisions that component's own header comment defends:
 * focus never leaves the `role="combobox"` input, options are only ever
 * "virtually focused" via `aria-activedescendant`, a polite live region
 * announces the result count, and `Dialog` (Radix) owns Esc / focus
 * restore. Read `global-search.tsx`'s comment first — everything it says
 * still applies here, this file just adds the tab layer on top.
 *
 * **Tabs are not a roving tabstop (D11).** They follow the WAI-ARIA tabs
 * pattern for markup (`role="tablist"`/`"tab"`/`"tabpanel"`,
 * `aria-selected`, `aria-controls`) but every trigger is `tabIndex={-1}` —
 * keyboard focus stays on the input the whole time, exactly like
 * `GlobalSearch`'s options. Switching tabs happens only via the shortcuts
 * below, never by tabbing to a `role="tab"` element and pressing arrow
 * keys the way a native tablist would. That is why this file hand-rolls
 * the tab markup instead of importing `../primitives/tabs`: that
 * primitive (Radix `Tabs`) owns its own arrow-key roving-tabstop
 * behaviour between triggers, which is exactly the behaviour D11 rules
 * out.
 *
 * **Keyboard model (D11, locked — do not "fix" back to the UX doc's
 * literal wording):**
 * - `←`/`→` step to the adjacent tab (clamped, no wrap).
 * - `Ctrl+1`/`Ctrl+2`/`Ctrl+3` jump directly to People/Page/Action.
 * - Typing `/` as the very first character (query was empty) jumps to
 *   the Page tab; typing `>` as the first character jumps to Action.
 *   Both are consumed as the tab switch and never become query text.
 * - `Tab` keeps its native browser meaning (moves focus out of the
 *   input) — deliberately unbound here, unlike the UX doc's own §4
 *   prose which still says "`←`/`→` (and `Tab`) move between tabs". D11
 *   overrides that: binding `Tab` would break the browser's own
 *   focus-traversal contract for every other field in this dialog.
 * - `↑`/`↓`/`Enter` behave exactly like `GlobalSearch` today, scoped to
 *   whichever tab is active.
 *
 * **Recents (D10).** The People tab's empty-query state renders
 * `useRecentItems()` — a local-only, per-device ring buffer
 * (`../hooks/recent-items.ts`), not a caller-supplied group. It is a
 * convenience for "reopen what I just looked at", never a source of
 * truth, so it degrades to the plain searchable hint when storage is
 * blocked or empty rather than surfacing an error.
 */
import * as React from 'react';

import { useRecentItems } from '../hooks/recent-items';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import type { GlobalSearchGroup, GlobalSearchResult } from './global-search';
import { Input } from './input';
import { Skeleton } from './skeleton';

export type CommandPaletteTabId = 'people' | 'page' | 'action';

const TAB_ORDER: readonly CommandPaletteTabId[] = ['people', 'page', 'action'];

export interface CommandPaletteTab {
  id: CommandPaletteTabId;
  label: string;
  groups: readonly GlobalSearchGroup[];
  /** Shown while `query` is empty (People also layers recents above
   * this, see the file comment). */
  searchableHint?: string;
  noResultsText?: (query: string) => string;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Exactly three tabs, People first — matches D11's "opens on People". */
  tabs: readonly [CommandPaletteTab, CommandPaletteTab, CommandPaletteTab];
  onSelect: (tabId: CommandPaletteTabId, groupId: string, resultId: string) => void;
  /** Accessible name for the input — same reasoning as `GlobalSearch`'s
   * identical prop: there is no visible `<label>`. */
  'aria-label': string;
  title?: string;
  placeholder?: string;
  description?: string;
  announceResults?: (count: number) => string;
  /** Overrides which tab is active on mount — D11 still means the palette
   * opens on People by default (the default here), but a caller that
   * already knows the viewer wants a specific tab (e.g. a Storybook story
   * demonstrating the Page tab, or `>`/`/` consuming the first keystroke
   * before this component ever mounts) can skip the extra keypress. */
  initialTab?: CommandPaletteTabId;
}

interface FlatOption {
  groupId: string;
  groupLabel: string;
  result: GlobalSearchResult;
}

function flatten(groups: readonly GlobalSearchGroup[]): FlatOption[] {
  return groups.flatMap((group) =>
    group.results.map((result) => ({ groupId: group.id, groupLabel: group.label, result })),
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  query,
  onQueryChange,
  tabs,
  onSelect,
  'aria-label': ariaLabel,
  title = 'Command palette',
  placeholder = 'Search students, guardians, pages, and actions…',
  description = 'Search across people, pages, and actions. Use the arrow keys to move between results and Enter to open one.',
  announceResults = (count) => `${count} result${count === 1 ? '' : 's'}`,
  initialTab = 'people',
}: CommandPaletteProps) {
  const [activeTab, setActiveTab] = React.useState<CommandPaletteTabId>(initialTab);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const listboxId = React.useId();
  const tablistId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { recentItems, addRecentItem } = useRecentItems();

  // Every open resets both the tab and the walked-option index — a
  // reopened palette should never silently resume a stale tab/selection
  // from the session before.
  React.useEffect(() => {
    if (open) {
      setActiveTab('people');
      setActiveIndex(-1);
    }
  }, [open]);

  const tabById = React.useMemo(() => {
    const map = new Map<CommandPaletteTabId, CommandPaletteTab>();
    for (const tab of tabs) map.set(tab.id, tab);
    return map;
  }, [tabs]);
  const activeTabData = tabById.get(activeTab) ?? tabs[0];

  const trimmedQuery = query.trim();
  const isPeopleEmptyQuery = activeTab === 'people' && trimmedQuery === '';
  const options = isPeopleEmptyQuery ? [] : flatten(activeTabData.groups);
  const totalResults = isPeopleEmptyQuery ? recentItems.length : options.length;
  const anyLoading = activeTabData.groups.some((group) => group.isLoading);
  const clampedActiveIndex = activeIndex >= totalResults ? totalResults - 1 : activeIndex;

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  function tabElementId(tabId: CommandPaletteTabId): string {
    return `${tablistId}-tab-${tabId}`;
  }

  function switchTab(tabId: CommandPaletteTabId) {
    setActiveTab(tabId);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function selectFlatOption(option: FlatOption) {
    onSelect(activeTabData.id, option.groupId, option.result.id);
    if (activeTabData.id === 'people') {
      addRecentItem({
        id: `${option.groupId}:${option.result.id}`,
        groupId: option.groupId,
        resultId: option.result.id,
        label: option.result.label,
        ...(option.result.description !== undefined && { description: option.result.description }),
      });
    }
    onOpenChange(false);
  }

  function selectRecentItem(item: (typeof recentItems)[number]) {
    onSelect('people', item.groupId, item.resultId);
    addRecentItem(item);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-24 max-w-lg -translate-y-0 gap-3 p-0 sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <div className="flex flex-col gap-0 p-2">
          <DialogTitle asChild>
            <VisuallyHiddenTitle>{title}</VisuallyHiddenTitle>
          </DialogTitle>
          <DialogDescription asChild>
            <VisuallyHiddenTitle>{description}</VisuallyHiddenTitle>
          </DialogDescription>

          <div role="tablist" aria-label={ariaLabel} className="mb-1 flex gap-1 px-1">
            {tabs.map((tab) => (
              // Not a real keyboard target — see file comment: tabs are
              // switched only via the shortcuts below, focus stays on
              // the input, so `tabIndex={-1}` deliberately removes these
              // from Tab-key traversal.
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={tabElementId(tab.id)}
                aria-selected={activeTab === tab.id}
                aria-controls={`${listboxId}-panel-${tab.id}`}
                tabIndex={-1}
                data-active={activeTab === tab.id}
                className="rounded-md px-2 py-1 text-sm text-muted-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => switchTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <Input
            ref={inputRef}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              clampedActiveIndex >= 0 ? optionId(clampedActiveIndex) : undefined
            }
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              const nextValue = event.target.value;
              // D11: `/` or `>` as the very first character (query was
              // empty before this keystroke) is a tab-switch trigger,
              // not query text — consume it rather than searching for
              // a literal "/" or ">".
              if (trimmedQuery === '' && nextValue === '/') {
                switchTab('page');
                return;
              }
              if (trimmedQuery === '' && nextValue === '>') {
                switchTab('action');
                return;
              }
              onQueryChange(nextValue);
              setActiveIndex(-1);
            }}
            onKeyDown={(event) => {
              if (event.ctrlKey && event.key === '1') {
                event.preventDefault();
                switchTab('people');
              } else if (event.ctrlKey && event.key === '2') {
                event.preventDefault();
                switchTab('page');
              } else if (event.ctrlKey && event.key === '3') {
                event.preventDefault();
                switchTab('action');
              } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                const index = TAB_ORDER.indexOf(activeTab);
                switchTab(TAB_ORDER[Math.max(index - 1, 0)] ?? activeTab);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                const index = TAB_ORDER.indexOf(activeTab);
                switchTab(TAB_ORDER[Math.min(index + 1, TAB_ORDER.length - 1)] ?? activeTab);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, totalResults - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                if (isPeopleEmptyQuery) {
                  const item =
                    clampedActiveIndex >= 0 ? recentItems[clampedActiveIndex] : recentItems[0];
                  if (item) {
                    event.preventDefault();
                    selectRecentItem(item);
                  }
                } else {
                  const option = clampedActiveIndex >= 0 ? options[clampedActiveIndex] : options[0];
                  if (option) {
                    event.preventDefault();
                    selectFlatOption(option);
                  }
                }
              }
              // `Tab` is deliberately unhandled — D11 keeps its native
              // browser meaning, see file comment.
              // `Escape` is deliberately unhandled — `DialogContent`
              // (Radix) already closes and restores focus on its own.
            }}
            className="border-none shadow-none focus-visible:ring-0"
          />
        </div>

        <div aria-live="polite" className="sr-only">
          {isPeopleEmptyQuery
            ? recentItems.length > 0
              ? announceResults(recentItems.length)
              : ''
            : trimmedQuery !== ''
              ? announceResults(totalResults)
              : ''}
        </div>

        <div
          role="tabpanel"
          id={`${listboxId}-panel-${activeTabData.id}`}
          aria-labelledby={tabElementId(activeTabData.id)}
          className="max-h-96 overflow-y-auto border-t border-border-subtle p-2"
        >
          {isPeopleEmptyQuery ? (
            recentItems.length > 0 ? (
              <div role="listbox" id={listboxId} aria-label={ariaLabel}>
                <div
                  role="presentation"
                  className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                >
                  Recent
                </div>
                {recentItems.map((item, index) => (
                  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                  <div
                    key={item.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={index === clampedActiveIndex}
                    data-active={index === clampedActiveIndex}
                    className="cursor-default rounded-md px-2 py-1.5 text-sm data-[active=true]:bg-accent"
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectRecentItem(item)}
                  >
                    <div>{item.label}</div>
                    {item.description !== undefined && (
                      <div className="text-xs text-muted-foreground">{item.description}</div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-2 py-4 text-sm text-muted-foreground">
                {activeTabData.searchableHint ??
                  'Search by student name, roll number, guardian, teacher, or invoice number.'}
              </p>
            )
          ) : trimmedQuery === '' ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              {activeTabData.searchableHint ?? 'Start typing to search.'}
            </p>
          ) : anyLoading && totalResults === 0 ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : totalResults === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">
              {(activeTabData.noResultsText ?? ((q: string) => `No matches for "${q}".`))(
                trimmedQuery,
              )}
            </p>
          ) : (
            <div role="listbox" id={listboxId} aria-label={ariaLabel}>
              {activeTabData.groups
                .filter((group) => group.results.length > 0)
                .map((group) => (
                  <div key={group.id} className="mb-2 last:mb-0">
                    <div
                      role="presentation"
                      className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      {group.label}
                    </div>
                    {group.results.map((result) => {
                      const index = options.findIndex(
                        (option) => option.groupId === group.id && option.result.id === result.id,
                      );
                      return (
                        // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                        <div
                          key={result.id}
                          id={optionId(index)}
                          role="option"
                          aria-selected={index === clampedActiveIndex}
                          data-active={index === clampedActiveIndex}
                          className="cursor-default rounded-md px-2 py-1.5 text-sm data-[active=true]:bg-accent"
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() =>
                            selectFlatOption({ groupId: group.id, groupLabel: group.label, result })
                          }
                        >
                          <div>{result.label}</div>
                          {result.description !== undefined && (
                            <div className="text-xs text-muted-foreground">
                              {result.description}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Same reasoning as `global-search.tsx`'s identical helper — Radix
 * requires a real accessible `DialogTitle`/`DialogDescription` child, but
 * this palette's visible input already carries the user-facing label via
 * `aria-label`. */
function VisuallyHiddenTitle({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
