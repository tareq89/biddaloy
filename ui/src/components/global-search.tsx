/**
 * [8.9.9]'s Cmd/Ctrl+K palette. Same WAI-ARIA combobox contract as
 * `./combobox.tsx` — focus stays on the `<input role="combobox">` for the
 * whole interaction, options are never themselves focused, the current
 * one is "virtually focused" via `aria-activedescendant`, and a result
 * count announces through a polite live region — but wrapped in a
 * `Dialog` instead of a `Popover`, since a global launch-from-anywhere
 * search is a modal task, not a field-level autocomplete: `Dialog`'s own
 * focus trap and restore-focus-to-trigger-on-close behaviour (Radix's,
 * exercised by `dialog.test.tsx`) is exactly [8.9.9]'s "closes on Esc,
 * restores focus where it was" acceptance criterion, and reimplementing
 * either here would just be a worse copy of what the wrapper already
 * gives every other dialog in the app.
 *
 * Route-agnostic like every other `ui` component (`app-shell.tsx`'s own
 * comment on why `AppShellNavItem.to` is untyped applies here too) —
 * this component only ever hands back the `(groupId, resultId)` pair the
 * caller gave it in `groups`; deciding what that pair navigates to (a
 * student's own page, a guardian's linked student, an invoice, or
 * nothing at all for a teacher until that detail page exists) is the
 * consuming app's job, not this component's.
 *
 * Literal English strings below are plain fallbacks, not `t()` calls —
 * every prop with a default has one only so a caller that forgets to
 * pass a translation still gets readable English, per `ui/CONTRIBUTING.md`'s
 * "i18n rules": nothing here should depend on that wording staying stable.
 */
import * as React from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { Input } from './input';
import { Skeleton } from './skeleton';

export interface GlobalSearchResult {
  id: string;
  label: string;
  description?: string;
}

export interface GlobalSearchGroup {
  id: string;
  label: string;
  results: readonly GlobalSearchResult[];
  isLoading?: boolean;
}

export interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  groups: readonly GlobalSearchGroup[];
  onSelect: (groupId: string, resultId: string) => void;
  /** Accessible name for the input — required, same reasoning as
   * `Combobox`'s `aria-label`: this input has no visible `<label>`. */
  'aria-label': string;
  title?: string;
  placeholder?: string;
  /** The dialog's hidden accessible description (Radix's `aria-describedby`
   * contract) — deliberately its own copy, not a reuse of `searchableHint`
   * below: that hint's visible text already exists once in the listbox
   * (as the pre-search empty state) and again here would double-announce
   * the same sentence to a screen reader. */
  description?: string;
  /** Shown while `query` is empty — explains what's searchable rather
   * than the dead-end "type to search" placeholder alone, per [8.9.9]'s
   * own empty-result acceptance criterion applied to the *pre*-search
   * state too. */
  searchableHint?: string;
  /** Shown when `query` is non-empty but every group came back empty —
   * distinct from `searchableHint` so a genuine no-match state never
   * reads as "nothing is searchable here". */
  noResultsText?: (query: string) => string;
  announceResults?: (count: number) => string;
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

export function GlobalSearch({
  open,
  onOpenChange,
  query,
  onQueryChange,
  groups,
  onSelect,
  'aria-label': ariaLabel,
  title = 'Search',
  placeholder = 'Search students, guardians, teachers, invoices…',
  description = 'Search across students, guardians, teachers, and invoices. Use the arrow keys to move between results and Enter to open one.',
  searchableHint = 'Search by student name, roll number, guardian, teacher, or invoice number.',
  noResultsText = (q) => `No matches for "${q}". Try a name, roll number, or invoice number.`,
  announceResults = (count) => `${count} result${count === 1 ? '' : 's'}`,
}: GlobalSearchProps) {
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const listboxId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const options = flatten(groups);
  const totalResults = options.length;
  const anyLoading = groups.some((group) => group.isLoading);
  const trimmedQuery = query.trim();

  // Every open (including via the global Cmd/Ctrl+K listener, which
  // never touches this input directly) resets the walked-option index —
  // a stale `activeIndex` from the previous session would otherwise
  // point at a now-unrelated row the moment new results land.
  React.useEffect(() => {
    if (open) setActiveIndex(-1);
  }, [open]);

  function optionId(index: number): string {
    return `${listboxId}-option-${index}`;
  }

  function selectOption(option: FlatOption) {
    onSelect(option.groupId, option.result.id);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-24 max-w-lg -translate-y-0 gap-3 p-0 sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          // Radix's default is "focus the first focusable descendant",
          // which is already this input — preventing default only so we
          // control the moment precisely (`inputRef.current?.focus()`
          // below) rather than relying on DOM order staying stable.
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
          <Input
            ref={inputRef}
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeIndex >= 0 ? optionId(activeIndex) : undefined}
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              onQueryChange(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, options.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === 'Enter') {
                if (activeIndex >= 0) {
                  event.preventDefault();
                  const option = options[activeIndex];
                  if (option) selectOption(option);
                }
              }
              // `Escape` is deliberately not handled here — `DialogContent`
              // (Radix) already closes and restores focus on its own; a
              // second handler here would be redundant, not additive.
            }}
            className="border-none shadow-none focus-visible:ring-0"
          />
        </div>

        <div aria-live="polite" className="sr-only">
          {trimmedQuery !== '' ? announceResults(totalResults) : ''}
        </div>

        <div
          role="listbox"
          id={listboxId}
          aria-label={ariaLabel}
          className="max-h-96 overflow-y-auto border-t border-border p-2"
        >
          {trimmedQuery === '' ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">{searchableHint}</p>
          ) : anyLoading && totalResults === 0 ? (
            <div className="flex flex-col gap-2 p-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : totalResults === 0 ? (
            <p className="px-2 py-4 text-sm text-muted-foreground">{noResultsText(trimmedQuery)}</p>
          ) : (
            groups
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
                      // Per the WAI-ARIA combobox pattern (see `combobox.tsx`'s
                      // own comment): options are never a real keyboard
                      // target, every interaction is handled by the input's
                      // `onKeyDown` above.
                      // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
                      <div
                        key={result.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === activeIndex}
                        data-active={index === activeIndex}
                        className="cursor-default rounded-md px-2 py-1.5 text-sm data-[active=true]:bg-accent"
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() =>
                          selectOption({ groupId: group.id, groupLabel: group.label, result })
                        }
                      >
                        <div>{result.label}</div>
                        {result.description !== undefined && (
                          <div className="text-xs text-muted-foreground">{result.description}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Renders its child visually hidden without an extra DOM wrapper's own
 * a11y semantics leaking in — `DialogTitle`/`DialogDescription` both
 * require a real accessible child (Radix warns otherwise), but this
 * palette's own visible input already carries the user-facing label via
 * `aria-label`, so the title/description exist for the accessibility
 * tree only. */
function VisuallyHiddenTitle({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
