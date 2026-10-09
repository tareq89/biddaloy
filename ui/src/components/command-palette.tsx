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
 * - Row 1 is always highlighted (index 0 on open, tab switch and query
 *   change), so `Enter` opens exactly what is visibly highlighted.
 * - `↑`/`↓` wrap around and scroll the highlighted row into view. Scrolling
 *   happens on key presses only; hover moves the highlight on real
 *   `mousemove`, so a list scrolling under a still pointer never fights the
 *   keyboard (#1733).
 * - Disabled rows (`result.disabled`) are listed and reachable, but `Enter`
 *   / click does nothing; the reason is the row's `description`.
 *
 * **Recents (D10, #1733 D12).** An empty query on each tab shows a "Recent"
 * section from `useRecentItems()` — a local-only, per-device ring buffer
 * (`../hooks/recent-items.ts`) with its own key per tab. Page and Action
 * recents are resolved against the live list, so a removed or no-longer
 * permitted entry silently drops out. It is a convenience, never a source of
 * truth, so it degrades to nothing when storage is blocked or empty.
 */
import * as React from 'react';

import { useRecentItems } from '../hooks/recent-items';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Input } from './input';
import { Skeleton } from './skeleton';

/** [30.5.1] Moved here from the now-deleted `global-search.tsx` — this
 * was that component's own result-group shape, and `CommandPalette` is
 * the only consumer left once `GlobalSearch` was retired. */
export interface GlobalSearchResult {
  id: string;
  label: string;
  /** Secondary line. For a `disabled` row this is the reason. */
  description?: string;
  /** Listed and reachable by keyboard, but cannot be opened. */
  disabled?: boolean;
}

export interface GlobalSearchGroup {
  id: string;
  label: string;
  results: readonly GlobalSearchResult[];
  isLoading?: boolean;
}

export type CommandPaletteTabId = 'people' | 'page' | 'action';

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
  /** Tabs in display order — People first *when present* (D11's "opens on
   * People"); callers omit it when the viewer cannot search people. */
  tabs: readonly [CommandPaletteTab, ...CommandPaletteTab[]];
  onSelect: (tabId: CommandPaletteTabId, groupId: string, resultId: string) => void;
  /** Accessible name for the input — same reasoning as `GlobalSearch`'s
   * identical prop: there is no visible `<label>`. */
  'aria-label': string;
  title?: string;
  placeholder?: string;
  description?: string;
  announceResults?: (count: number) => string;
  /** Overrides which tab is active on mount — D11 still means the palette
   * opens on its first tab, People when present (the default here), but a caller that
   * already knows the viewer wants a specific tab (e.g. a Storybook story
   * demonstrating the Page tab, or `>`/`/` consuming the first keystroke
   * before this component ever mounts) can skip the extra keypress. */
  initialTab?: CommandPaletteTabId;
  /** Shortcut hint bar under the results. Omit for no footer. */
  footerHint?: string;
  /** Header of the recents section. */
  recentLabel?: string;
}

interface FlatOption {
  /** Section the row renders under (`'recent'` for the recents section). */
  groupId: string;
  groupLabel: string;
  /** The group id `onSelect` receives; differs from `groupId` for recents. */
  sourceGroupId: string;
  result: GlobalSearchResult;
}

function flatten(groups: readonly GlobalSearchGroup[]): FlatOption[] {
  return groups.flatMap((group) =>
    group.results.map((result) => ({
      groupId: group.id,
      groupLabel: group.label,
      sourceGroupId: group.id,
      result,
    })),
  );
}

/** Bolds the typed text inside the label; a synonym-only match stays plain. */
function highlight(label: string, query: string): React.ReactNode {
  // Match on the original string: lower-casing can change length ('İ'), so an
  // offset found in a lower-cased copy would be wrong for the original.
  const found =
    query === '' ? null : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(label);
  if (!found) return label;
  const start = found.index;
  const end = start + found[0].length;
  return (
    <>
      {label.slice(0, start)}
      <mark className="bg-transparent font-semibold text-foreground">
        {label.slice(start, end)}
      </mark>
      {label.slice(end)}
    </>
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
  initialTab,
  footerHint,
  recentLabel = 'Recent',
}: CommandPaletteProps) {
  const [activeTab, setActiveTab] = React.useState<CommandPaletteTabId>(initialTab ?? tabs[0].id);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const listboxId = React.useId();
  const tablistId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const lastPointer = React.useRef<{ x: number; y: number } | null>(null);
  const recentsByTab = {
    people: useRecentItems(),
    page: useRecentItems('page'),
    action: useRecentItems('action'),
  };

  // Every open resets both the tab and the walked-option index — a
  // reopened palette should never silently resume a stale tab/selection
  // from the session before. Resets to `initialTab`, not a hard-coded
  // 'people' — otherwise this effect firing on mount (when `open` starts
  // `true`, e.g. a Storybook story or a caller that mounts pre-opened)
  // would immediately override the caller-supplied `initialTab`.
  React.useEffect(() => {
    if (open) {
      setActiveTab(initialTab ?? tabs[0].id);
    }
    // Deliberately excludes `initialTab`: it's a mount-time default, not
    // something a later prop change should re-trigger a reset for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const tabById = React.useMemo(() => {
    const map = new Map<CommandPaletteTabId, CommandPaletteTab>();
    for (const tab of tabs) map.set(tab.id, tab);
    return map;
  }, [tabs]);
  const activeTabData = tabById.get(activeTab) ?? tabs[0];

  const trimmedQuery = query.trim();
  const { recentItems, addRecentItem } = recentsByTab[activeTabData.id];
  // People ignores stale debounced server results while the query is empty;
  // Page and Action list everything when nothing is typed (#1733 D2).
  const tabRows =
    activeTabData.id === 'people' && trimmedQuery === '' ? [] : flatten(activeTabData.groups);
  const recentOptions: FlatOption[] =
    trimmedQuery !== ''
      ? []
      : activeTabData.id === 'people'
        ? recentItems.map((item) => ({
            groupId: 'recent',
            groupLabel: recentLabel,
            sourceGroupId: item.groupId,
            result: {
              id: item.resultId,
              label: item.label,
              ...(item.description !== undefined && { description: item.description }),
            },
          }))
        : // Resolved against the live rows: a removed / no-longer-permitted
          // entry drops out, a context action without its context is disabled.
          recentItems.flatMap((item) => {
            const hit = tabRows.find((row) => row.result.id === item.resultId);
            return hit
              ? [
                  {
                    ...hit,
                    groupId: 'recent',
                    groupLabel: recentLabel,
                    sourceGroupId: hit.sourceGroupId,
                  },
                ]
              : [];
          });
  const options = [...recentOptions, ...tabRows];
  const anyLoading = activeTabData.groups.some((group) => group.isLoading);
  const clampedActiveIndex = options.length === 0 ? -1 : Math.min(activeIndex, options.length - 1);
  // [30.5.1] Mirrors exactly which branch below renders a `role="listbox"`
  // element bearing `id={listboxId}` — the loading skeleton, the hint and
  // the "no results" branches render none. `aria-controls` pointing at an id
  // with no matching element is an `aria-valid-attr-value` violation, so the
  // input only claims to control the listbox while one actually exists.
  const hasListbox = options.length > 0;

  // Row 1 on open, tab switch and query change; scroll back to the top too.
  React.useEffect(() => {
    setActiveIndex(0);
    if (panelRef.current) panelRef.current.scrollTop = 0;
  }, [open, activeTabData.id, trimmedQuery]);

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  function tabElementId(tabId: CommandPaletteTabId): string {
    return `${tablistId}-tab-${tabId}`;
  }

  function switchTab(tabId: CommandPaletteTabId) {
    if (!tabById.has(tabId)) return;
    setActiveTab(tabId);
    inputRef.current?.focus();
  }

  // One linear pass: consecutive options with the same section id share a header.
  const sections: {
    id: string;
    label: string;
    rows: { option: FlatOption; index: number }[];
  }[] = [];
  options.forEach((option, index) => {
    const last = sections[sections.length - 1];
    if (last && last.id === option.groupId) last.rows.push({ option, index });
    else sections.push({ id: option.groupId, label: option.groupLabel, rows: [{ option, index }] });
  });

  /** Keyboard-only move: wraps are the caller's job; scrolls the row into view. */
  function moveTo(next: number) {
    setActiveIndex(next);
    if (next === 0 && panelRef.current)
      panelRef.current.scrollTop = 0; // show the first group header on wrap
    else document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' });
  }

  function selectOption(option: FlatOption) {
    if (option.result.disabled) return;
    onSelect(activeTabData.id, option.sourceGroupId, option.result.id);
    addRecentItem({
      id: `${option.sourceGroupId}:${option.result.id}`,
      groupId: option.sourceGroupId,
      resultId: option.result.id,
      label: option.result.label,
      ...(option.result.description !== undefined && { description: option.result.description }),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-4 max-w-lg -translate-y-0 gap-3 p-0 sm:top-24 sm:max-w-lg"
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
                aria-selected={activeTabData.id === tab.id}
                aria-controls={`${listboxId}-panel-${tab.id}`}
                tabIndex={-1}
                data-active={activeTabData.id === tab.id}
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
              if (trimmedQuery === '' && nextValue === '/' && tabById.has('page')) {
                switchTab('page');
                return;
              }
              if (trimmedQuery === '' && nextValue === '>' && tabById.has('action')) {
                switchTab('action');
                return;
              }
              onQueryChange(nextValue);
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
                const index = tabs.findIndex((tab) => tab.id === activeTabData.id);
                switchTab(tabs[Math.max(index - 1, 0)]?.id ?? activeTab);
              } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                const index = tabs.findIndex((tab) => tab.id === activeTabData.id);
                switchTab(tabs[Math.min(index + 1, tabs.length - 1)]?.id ?? activeTab);
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (options.length) moveTo((clampedActiveIndex + 1) % options.length);
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (options.length) {
                  moveTo((clampedActiveIndex - 1 + options.length) % options.length);
                }
              } else if (event.key === 'Enter') {
                const option = options[clampedActiveIndex];
                if (option) {
                  event.preventDefault();
                  selectOption(option);
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
          {trimmedQuery !== '' || options.length > 0 ? announceResults(tabRows.length) : ''}
        </div>

        <div
          ref={panelRef}
          role="tabpanel"
          id={`${listboxId}-panel-${activeTabData.id}`}
          aria-labelledby={tabElementId(activeTabData.id)}
          className="h-[min(60dvh,28rem)] overflow-y-auto border-t border-border-subtle p-2"
        >
          {/* `role="combobox"` requires `aria-controls` to name a real
           * element (`aria-required-attr`) even while nothing is shown
           * below — the hint/skeleton/no-results branches below render
           * no `id={listboxId}` element of their own, so this empty
           * placeholder stands in for it exactly when `hasListbox` is
           * false, keeping the input's `aria-controls` always valid. */}
          {!hasListbox && (
            <div role="listbox" id={listboxId} aria-label={ariaLabel} className="sr-only" />
          )}
          {anyLoading && options.length === 0 && trimmedQuery !== '' ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : options.length > 0 ? (
            <div role="listbox" id={listboxId} aria-label={ariaLabel}>
              {sections.map((section) => (
                <div key={section.id} className="mb-2 last:mb-0">
                  {section.label !== '' && (
                    <div
                      role="presentation"
                      className="px-2 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase"
                    >
                      {section.label}
                    </div>
                  )}
                  {section.rows.map(({ option, index }) => {
                    const { result } = option;
                    return (
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                      <div
                        key={`${section.id}:${result.id}`}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === clampedActiveIndex}
                        aria-disabled={result.disabled ? true : undefined}
                        data-active={index === clampedActiveIndex}
                        data-disabled={result.disabled ? true : undefined}
                        className="cursor-default rounded-md px-2 py-1.5 text-sm data-[active=true]:bg-accent data-[disabled=true]:cursor-not-allowed data-[disabled=true]:text-muted-foreground"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseMove={(event) => {
                          // Ignore the synthetic mousemove a scroll fires under a still pointer.
                          const last = lastPointer.current;
                          lastPointer.current = { x: event.clientX, y: event.clientY };
                          if (last && last.x === event.clientX && last.y === event.clientY) return;
                          setActiveIndex(index);
                        }}
                        onClick={() => selectOption(option)}
                      >
                        <div>{highlight(result.label, trimmedQuery)}</div>
                        {result.description !== undefined && (
                          <div className="text-xs text-muted-foreground">{result.description}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p className="flex h-full items-center justify-center px-2 text-center text-sm text-muted-foreground">
              {trimmedQuery === ''
                ? (activeTabData.searchableHint ??
                  (activeTabData.id === 'people'
                    ? 'Search by student name, roll number, guardian, teacher, or invoice number.'
                    : 'Start typing to search.'))
                : (activeTabData.noResultsText ?? ((q: string) => `No matches for "${q}".`))(
                    trimmedQuery,
                  )}
            </p>
          )}
        </div>

        {footerHint !== undefined && (
          <div className="border-t border-border-subtle px-3 py-2 text-xs text-muted-foreground">
            {footerHint}
          </div>
        )}
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
