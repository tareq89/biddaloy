/**
 * [30.3.2] — presentational, route-agnostic breadcrumb trail per
 * `docs/architecture/15-ux-principles.md` §5.
 *
 * Like `AppShell`/`BottomNav` (`app-shell.tsx`, `bottom-nav.tsx`), this
 * component never imports the consumer's generated `routeTree.gen.ts` —
 * `item.to` is an untyped path string the caller is trusted to resolve,
 * and the caller also resolves each `label` (this component never fetches
 * or looks up a name for an id). Real `Link`s, not `<a href>`, for the
 * same reason those two components use them: hovering triggers the
 * router's `defaultPreload: 'intent'`.
 *
 * Every item but the last renders as a `Link`; the last renders as plain
 * text carrying `aria-current="page"` — it names the current page, it
 * doesn't navigate to it. Separators are decorative (`aria-hidden`) so a
 * screen reader hears only the crumb labels, not "slash" between each.
 *
 * Responsive truncation is pure CSS, no JS width measurement: below `md`
 * only the last two items render, via `hidden md:flex` on every earlier
 * item's `<li>` (which hides that item's leading separator along with it,
 * so the mobile trail never starts with a stray separator).
 */
import { Link } from '@tanstack/react-router';

import { cn } from '../primitives/lib/utils';

export interface BreadcrumbItem {
  /** Already-resolved display text — this component does not fetch or
   * resolve names itself. */
  label: string;
  /** A route path, untyped against the app's route tree on purpose (see
   * `AppShellNavItem.to`'s own comment on staying route-tree-agnostic).
   * Omitted for a crumb that has no destination of its own. */
  to?: string;
}

export interface BreadcrumbsProps {
  /** The trail, root first, current page last. An empty array renders
   * nothing at all — not an empty `<nav>` — since a breadcrumb trail with
   * no crumbs conveys no location. */
  items: readonly BreadcrumbItem[];
  /** Accessible name for the `<nav>` landmark — a page can hold more than
   * one `<nav>`, so this is required reading for a screen-reader user
   * choosing between them. */
  'aria-label': string;
  className?: string;
}

export function Breadcrumbs({ items, 'aria-label': ariaLabel, className }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  const lastIndex = items.length - 1;

  return (
    <nav aria-label={ariaLabel} data-slot="breadcrumbs" className={className}>
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        {items.map((item, index) => {
          const isLast = index === lastIndex;
          // Below `md`, only the last two crumbs show — everything
          // earlier (and its separator, since it lives in the same `<li>`)
          // is hidden rather than measured/truncated in JS.
          const truncatedOnMobile = index < lastIndex - 1;

          return (
            <li
              key={`${item.label}:${index}`}
              className={cn('flex items-center gap-1', truncatedOnMobile && 'hidden md:flex')}
            >
              {index > 0 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  /
                </span>
              )}
              {isLast ? (
                <span aria-current="page" className="font-medium text-foreground">
                  {item.label}
                </span>
              ) : item.to !== undefined ? (
                <Link to={item.to} className="text-muted-foreground hover:text-foreground">
                  {item.label}
                </Link>
              ) : (
                <span className="text-muted-foreground">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
