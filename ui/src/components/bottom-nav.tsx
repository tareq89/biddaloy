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
 * `min-h-14` (56px) per item, comfortably past the 44px minimum touch
 * target the portal's accessibility AC calls for, and the label is always
 * visible text — never an icon alone, which would leave the item with no
 * accessible name for a screen reader and no meaning for anyone who
 * doesn't recognise the glyph.
 */
import { Link } from '@tanstack/react-router';

import { useActiveRole } from '../hooks/auth-state';
import { hasPermission } from '../hooks/permissions';
import { cn } from '../primitives/lib/utils';

import type { AppShellNavItem } from './app-shell';

export interface BottomNavProps {
  /** Same item shape `AppShell` takes, so one array feeds both the
   * sidebar and the bottom bar instead of two lists drifting apart. */
  items: readonly AppShellNavItem[];
  /** Accessible name for the nav landmark — a page can hold more than one
   * `<nav>`, so this is required reading for a screen-reader user
   * choosing between them. */
  label: string;
  className?: string;
}

/** `true` when some *other* visible item lives underneath `to` — the
 * `/portal` vs `/portal/fees` case. Segment-aware, so `/portal/fees`
 * doesn't claim `/portal/feesarchive` as a descendant. */
function hasDescendantItem(to: string, items: readonly AppShellNavItem[]): boolean {
  const prefix = to.endsWith('/') ? to : `${to}/`;
  return items.some((other) => other.to !== to && other.to.startsWith(prefix));
}

export function BottomNav({ items, label, className }: BottomNavProps) {
  const role = useActiveRole();
  const visible = items.filter(
    (item) => item.permission === undefined || hasPermission(role, item.permission),
  );

  if (visible.length === 0) return null;

  return (
    <nav
      aria-label={label}
      data-slot="bottom-nav"
      className={cn('flex border-t border-border bg-background', className)}
    >
      {visible.map((item) => (
        <Link
          key={`${item.to}:${item.label}`}
          to={item.to}
          {...(item.search !== undefined && { search: item.search })}
          {...(hasDescendantItem(item.to, visible) && { activeOptions: { exact: true } })}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-2 py-2 text-xs"
          // Split across active/inactive rather than one base colour
          // overridden by the other: TanStack concatenates the two class
          // strings, and two competing Tailwind text-colour utilities
          // would be resolved by stylesheet order, not by intent. This
          // way exactly one colour class is ever present.
          activeProps={{ className: 'font-medium text-primary' }}
          inactiveProps={{ className: 'text-muted-foreground' }}
        >
          {item.icon}
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}
