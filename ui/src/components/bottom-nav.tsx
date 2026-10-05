/**
 * [5.2] — the mobile bottom navigation the family portal's approved
 * mockup shows. `AppShell` has a sidebar (≥768px) and a drawer (<768px)
 * and nothing else; a two-item portal behind a hamburger is one tap too
 * many for the one screen a parent opens on a phone.
 *
 * A sibling component rather than an `AppShell` mode: it takes the same
 * `AppShellNavItem` shape, applies the same `hasPermission` gate, and is
 * handed to `AppShell` through its optional `bottomNav` slot. That keeps
 * the staff shell — which never renders one — on exactly the code path it
 * has today.
 *
 * Real `Link`s, not `<a href>`, for the same reason `app-shell.tsx` uses
 * them: hovering/tapping triggers the router's `defaultPreload: 'intent'`.
 *
 * `aria-current="page"` comes from `Link`'s own active state, but the
 * default prefix match is wrong for a bar containing an index route: on
 * `/portal/fees`, both `/portal` and `/portal/fees` match, and two
 * simultaneously "current" items tell a screen-reader user nothing. So an
 * item whose path is a strict ancestor of another visible item's gets
 * `activeOptions={{ exact: true }}`. `/portal` then only lights up on
 * `/portal` itself, while `/portal/fees` still lights up for a future
 * child route beneath it (`/portal/fees/2026-03`). Note this can't be
 * fixed by passing `aria-current` down: `Link` applies its own active
 * attributes last and they always win.
 *
 * `h-16` (64px) per cell (31.2.8b's toast offset assumes it), comfortably
 * past the 44px minimum touch target, and the label is always
 * visible text — never an icon alone, which would leave the item with no
 * accessible name for a screen reader and no meaning for anyone who
 * doesn't recognise the glyph.
 *
 * [8.14.3] `pb-(--safe-area-bottom)` on the `<nav>` clears the gesture-nav
 * home indicator of an installed PWA — `env()` resolves to `0px` everywhere
 * else, so this is a no-op outside that one context (see
 * `ui/src/styles/globals.css`'s own comment on the token). The optional
 * `more` prop renders a trailing cell that opens the `AppShell` drawer
 * (`useAppShellDrawer`, `./app-shell.tsx`) holding the full destination
 * list — staff have more than 5 permission-gated destinations, so `more`
 * plus at most 4 items is how this bar stays within the 5-cell cap without
 * dropping navigation. It is a `<button>`, not a `Link`: it opens an
 * overlay, not a route, so it never carries `aria-current`.
 */
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { useActiveRole } from '../hooks/auth-state';
import { hasPermission } from '../hooks/permissions';
import { cn } from '../primitives/lib/utils';

import { useAppShellDrawer, type AppShellNavItem } from './app-shell';

/** Shared cell layout every `<Link>` item and the `more` button both use —
 * kept in one place so the trailing cell can never visually drift from the
 * destination cells beside it. */
const CELL_CLASS =
  'group flex h-16 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-caption text-text-secondary aria-[current=page]:font-semibold aria-[current=page]:text-secondary-foreground data-[active=true]:font-semibold data-[active=true]:text-secondary-foreground';

/** Icon holder and one-line label shared by every cell. The tinted pill
 * shows on the current cell (`aria-current`) and on an active More. */
function CellContent({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <>
      <span className="flex h-7 w-14 items-center justify-center rounded-full group-aria-[current=page]:bg-secondary group-data-[active=true]:bg-secondary">
        {icon}
      </span>
      <span className="max-w-full truncate px-1">{label}</span>
    </>
  );
}

export interface BottomNavProps {
  /** Same item shape `AppShell` takes, so one array feeds both the
   * sidebar and the bottom bar instead of two lists drifting apart. At
   * most 5 cells total render below `md` — with `more` present, that
   * caps `items` at 4. Not enforced by silently truncating the array;
   * `bottom-nav.test.tsx` asserts the cap on the caller's fixture instead. */
  items: readonly AppShellNavItem[];
  /** Accessible name for the nav landmark — a page can hold more than one
   * `<nav>`, so this is required reading for a screen-reader user
   * choosing between them. */
  label: string;
  /** [8.14.3] Trailing cell opening the `AppShell` drawer via
   * `useAppShellDrawer` — requires an `AppShell` ancestor that also
   * received `mobileTitle` / `mobileActions` (see
   * `app-shell.tsx`'s own comment); without one the drawer never renders
   * and this button does nothing. `active`: the current page is in none of
   * the cells — the caller computes it. Marks the button with
   * `data-active`, never `aria-current` (it opens a drawer, not a page). */
  more?: { label: string; icon?: ReactNode; active?: boolean };
  className?: string;
}

/** `true` when some *other* visible item lives underneath `to` — the
 * `/portal` vs `/portal/fees` case. Segment-aware, so `/portal/fees`
 * doesn't claim `/portal/feesarchive` as a descendant. */
function hasDescendantItem(to: string, items: readonly AppShellNavItem[]): boolean {
  const prefix = to.endsWith('/') ? to : `${to}/`;
  return items.some((other) => other.to !== to && other.to.startsWith(prefix));
}

export function BottomNav({ items, label, more, className }: BottomNavProps) {
  const role = useActiveRole();
  const { open, isOpen } = useAppShellDrawer();
  const visible = items.filter(
    (item) => item.permission === undefined || hasPermission(role, item.permission),
  );

  // [8.14.3]: `more` is itself a form of navigation (it opens the drawer
  // holding every other destination), so its presence is enough reason to
  // render the bar even when the active role can see none of `items` — the
  // old `visible.length === 0` guard alone would otherwise leave that role
  // with no navigation at all below `md`.
  if (visible.length === 0 && more === undefined) return null;

  return (
    <nav
      aria-label={label}
      data-slot="bottom-nav"
      className={cn(
        // [8.14.3]: staff's four cells reuse the sidebar's own icon
        // elements (`_staff.tsx`), which carry no explicit size class —
        // the sidebar sizes them via its own `NavLink`-scoped selector
        // (`app-shell.tsx`'s `[&_svg:not([class*='size-'])]:size-4`). This
        // is that same fallback pattern, scoped to this bar, so an icon
        // with no size class of its own still renders at this bar's
        // established 20px (portal's stories always pass `size-5`
        // explicitly, so this never overrides an intentional choice).
        "flex border-t border-border-subtle bg-surface pb-(--safe-area-bottom) [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
    >
      {visible.map((item) => (
        <Link
          key={`${item.to}:${item.label}`}
          to={item.to}
          {...(item.search !== undefined && { search: item.search })}
          {...(hasDescendantItem(item.to, visible) && { activeOptions: { exact: true } })}
          className={CELL_CLASS}
        >
          <CellContent icon={item.icon} label={item.label} />
        </Link>
      ))}
      {more !== undefined && (
        <button
          type="button"
          onClick={open}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          data-active={more.active ? 'true' : undefined}
          className={CELL_CLASS}
        >
          <CellContent icon={more.icon} label={more.label} />
        </button>
      )}
    </nav>
  );
}
