/**
 * The frame every routed screen renders inside: a nav landmark down the
 * side, a main landmark for the active route's content. [8.9.1]'s job was
 * routing/code-splitting, not the full app-chrome epic (focus management
 * and the skip link are [8.9.7]'s). [8.9.5]'s tenant/role bar is the
 * optional `topBar` slot below — a full-width row above the sidebar+
 * content row, rendered by the caller (`TenantBar`, `ui/src/components/
 * tenant-bar.tsx`) so this component stays app-state-agnostic.
 *
 * [8.9.6] adds domain grouping (`navGroups`), per-item permission gating,
 * and the responsive drawer, per the approved `templates/sidebar` mockup:
 * - A group with zero items the active role can see (across `items` and
 *   `pinnedItems`) renders nothing at all, not a disabled heading — an
 *   accountant should never see an "Academics" heading they can't open.
 * - `pinnedItems` render above `items`, separated by a divider — e.g.
 *   ACCOUNTANT's Student Dues/Record Payment pinned atop Finance.
 * - Below 768px the `<aside>` gives way to a header bar with a menu
 *   button that opens the same nav inside a `Dialog` (`components/
 *   dialog.tsx`) used as a left-edge drawer — its focus trap and
 *   restore-focus-on-close behaviour is Radix's own, exercised end to end
 *   by `dialog.test.tsx` already, not reimplemented here.
 * - A group's collapsed state persists to `localStorage`, same read-in-
 *   initializer / write-in-effect shape as `data-table.tsx`'s column
 *   persistence, so a corrupt or blocked store just falls back to
 *   expanded rather than crashing the shell over a display preference.
 *
 * `navItems`/`navGroups` use real `Link` components (not `<a href>`)
 * specifically so hovering one triggers the router's
 * `defaultPreload: 'intent'` — the route's chunk and its loader data
 * start fetching before the click lands. `activeProps` adds
 * `aria-current="page"` on the current route's link, the same signal
 * sighted users get from the highlight.
 */
import type { Permission } from '@biddaloy/shared';
import { Link } from '@tanstack/react-router';
import { ChevronDownIcon, ChevronRightIcon, MenuIcon, XIcon } from 'lucide-react';
import { VisuallyHidden } from 'radix-ui';
import * as React from 'react';
import type { ReactNode } from 'react';

import { useActiveRole } from '../hooks/auth-state';
import { hasPermission } from '../hooks/permissions';

import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from './dialog';

export interface AppShellNavItem {
  /** A route path, e.g. `/students`. Untyped against the app's route
   * tree on purpose — `ui/` can't depend on a specific consumer's
   * generated `routeTree.gen.ts` (see `ui/src/routes/index.ts`'s own
   * comment on staying route-tree-agnostic), so the caller is trusted to
   * pass a real path. */
  to: string;
  /** Query params for `to`, passed through to `Link`'s `search` prop —
   * TanStack Router only serializes the query string from `search`, so a
   * `?tab=...` baked into `to` is silently dropped and every such item
   * ends up pointing at the bare path instead. */
  search?: Record<string, string>;
  label: string;
  icon?: ReactNode;
  /** Item is hidden — not disabled — unless the active role holds this
   * permission. Omit for an item every signed-in role should see (e.g.
   * Dashboard). */
  permission?: Permission;
}

export interface AppShellNavGroup {
  /** Stable id, used as the `localStorage` collapse-state key — must
   * stay constant across releases or a user's saved preference silently
   * resets. */
  id: string;
  label: string;
  /** Rendered above `items`, separated by a divider once both are
   * non-empty. */
  pinnedItems?: readonly AppShellNavItem[];
  items: readonly AppShellNavItem[];
}

export interface AppShellProps {
  /** Ungrouped items rendered above any group, no heading — Dashboard
   * today, per the issue context excluding it from the five domain
   * groups. */
  navItems: readonly AppShellNavItem[];
  /** Domain-grouped sections below `navItems` (Academics/People/Finance/
   * Communication/Administration) — "so future modules slot in without
   * restructuring" per [8.9.6]'s own issue text. Defaults to none, so
   * existing callers with only flat `navItems` keep working unchanged. */
  navGroups?: readonly AppShellNavGroup[];
  /** Rendered above the nav — a school/product name, typically. */
  brand?: ReactNode;
  /** [8.9.5]/[8.9.6]'s tenant/role bar — a full-width row above the
   * sidebar+content row, per the approved mockup. Optional so a route
   * with no active tenant yet (`/select-school` itself) can render
   * `AppShell`-free chrome instead of leaving this slot empty. */
  topBar?: ReactNode;
  /** Accessible name for the mobile menu-open button. */
  openMenuLabel?: string;
  /** Accessible name for the mobile drawer's close button. */
  closeMenuLabel?: string;
  /** Accessible name for the nav landmark. */
  navLabel?: string;
  /** The active route's content — a consuming app's root route renders
   * `<AppShell navItems={...}><Outlet /></AppShell>`. */
  children: ReactNode;
}

function visibleItems(
  items: readonly AppShellNavItem[],
  role: string | null,
): readonly AppShellNavItem[] {
  return items.filter(
    (item) => item.permission === undefined || hasPermission(role, item.permission),
  );
}

function NavLink({
  item,
  onNavigate,
}: {
  item: AppShellNavItem;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <li>
      <Link
        to={item.to}
        {...(item.search !== undefined && { search: item.search })}
        onClick={onNavigate}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent"
        activeProps={{ className: 'bg-accent font-medium', 'aria-current': 'page' }}
      >
        {item.icon}
        {item.label}
      </Link>
    </li>
  );
}

function readGroupCollapsed(groupId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(`nav-group-collapsed:${groupId}`) === 'true';
  } catch {
    // Storage blocked (private browsing) or unavailable — default expanded
    // rather than losing the group's contents over a display preference.
    return false;
  }
}

function NavGroupSection({
  group,
  role,
  onNavigate,
}: {
  group: AppShellNavGroup;
  role: string | null;
  onNavigate?: (() => void) | undefined;
}) {
  const pinned = visibleItems(group.pinnedItems ?? [], role);
  const rest = visibleItems(group.items, role);
  const [collapsed, setCollapsed] = React.useState(() => readGroupCollapsed(group.id));

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(`nav-group-collapsed:${group.id}`, String(collapsed));
    } catch {
      // Same as above — a failed write just doesn't persist, not worth
      // failing the toggle over.
    }
  }, [group.id, collapsed]);

  if (pinned.length === 0 && rest.length === 0) return null;

  const panelId = `nav-group-${group.id}`;

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
        aria-controls={panelId}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase hover:text-foreground"
      >
        <span>{group.label}</span>
        {collapsed ? (
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        )}
      </button>
      <ul id={panelId} hidden={collapsed} className="flex flex-col gap-1">
        {pinned.map((item) => (
          <NavLink key={`${item.to}:${item.label}`} item={item} onNavigate={onNavigate} />
        ))}
        {pinned.length > 0 && rest.length > 0 && (
          <li aria-hidden="true" className="my-1 border-t border-border" />
        )}
        {rest.map((item) => (
          <NavLink key={`${item.to}:${item.label}`} item={item} onNavigate={onNavigate} />
        ))}
      </ul>
    </div>
  );
}

function NavContent({
  navItems,
  navGroups,
  role,
  navLabel,
  onNavigate,
}: {
  navItems: readonly AppShellNavItem[];
  navGroups: readonly AppShellNavGroup[];
  role: string | null;
  navLabel: string;
  onNavigate?: (() => void) | undefined;
}) {
  const topItems = visibleItems(navItems, role);
  return (
    <nav aria-label={navLabel}>
      <ul className="mb-2 flex flex-col gap-1">
        {topItems.map((item) => (
          <NavLink key={`${item.to}:${item.label}`} item={item} onNavigate={onNavigate} />
        ))}
      </ul>
      {navGroups.map((group) => (
        <NavGroupSection key={group.id} group={group} role={role} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

export function AppShell({
  navItems,
  navGroups = [],
  brand,
  topBar,
  openMenuLabel = 'Open menu',
  closeMenuLabel = 'Close menu',
  navLabel = 'Main',
  children,
}: AppShellProps) {
  const role = useActiveRole();
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen flex-col">
      {topBar}
      <div className="flex flex-1 flex-col md:flex-row">
        <div className="flex items-center justify-between border-b border-border p-2 md:hidden">
          {brand !== undefined && <div className="text-sm font-semibold">{brand}</div>}
          <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
            <DialogTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm">
                <MenuIcon />
                <span className="sr-only">{openMenuLabel}</span>
              </Button>
            </DialogTrigger>
            <DialogContent
              showCloseButton={false}
              className="start-0 top-0 h-full w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none p-4 sm:max-w-[85vw]"
            >
              <div className="mb-4 flex items-center justify-between">
                {brand !== undefined ? (
                  <DialogTitle className="text-sm font-semibold">{brand}</DialogTitle>
                ) : (
                  <VisuallyHidden.Root asChild>
                    <DialogTitle>Navigation</DialogTitle>
                  </VisuallyHidden.Root>
                )}
                <DialogClose asChild>
                  <Button type="button" variant="ghost" size="icon-sm">
                    <XIcon />
                    <span className="sr-only">{closeMenuLabel}</span>
                  </Button>
                </DialogClose>
              </div>
              <NavContent
                navItems={navItems}
                navGroups={navGroups}
                role={role}
                navLabel={navLabel}
                onNavigate={() => setDrawerOpen(false)}
              />
            </DialogContent>
          </Dialog>
        </div>

        <aside className="hidden w-60 shrink-0 flex-col gap-6 border-r border-border bg-muted/30 p-4 md:flex">
          {brand !== undefined && <div className="text-sm font-semibold">{brand}</div>}
          <NavContent navItems={navItems} navGroups={navGroups} role={role} navLabel={navLabel} />
        </aside>

        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
