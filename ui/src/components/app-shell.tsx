/**
 * The frame every routed screen renders inside: a nav landmark down the
 * side, a main landmark for the active route's content. [8.9.1]'s job is
 * routing/code-splitting, not the full app-chrome epic (focus management
 * and the skip link are [8.9.7]'s). [8.9.5]'s tenant/role bar is the
 * optional `topBar` slot below — a full-width row above the sidebar+
 * content row, rendered by the caller (`TenantBar`, `ui/src/components/
 * tenant-bar.tsx`) so this component stays app-state-agnostic.
 *
 * `navItems` uses real `Link` components (not `<a href>`) specifically so
 * hovering one triggers the router's `defaultPreload: 'intent'` — the
 * route's chunk and its loader data start fetching before the click
 * lands. `activeProps` adds `aria-current="page"` on the current route's
 * link, the same signal sighted users get from the highlight.
 */
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export interface AppShellNavItem {
  /** A route path, e.g. `/students`. Untyped against the app's route
   * tree on purpose — `ui/` can't depend on a specific consumer's
   * generated `routeTree.gen.ts` (see `ui/src/routes/index.ts`'s own
   * comment on staying route-tree-agnostic), so the caller is trusted to
   * pass a real path. */
  to: string;
  label: string;
  icon?: ReactNode;
}

export interface AppShellProps {
  navItems: readonly AppShellNavItem[];
  /** Rendered above the nav — a school/product name, typically. */
  brand?: ReactNode;
  /** [8.9.5]/[8.9.6]'s tenant/role bar — a full-width row above the
   * sidebar+content row, per the approved mockup. Optional so a route
   * with no active tenant yet (`/select-school` itself) can render
   * `AppShell`-free chrome instead of leaving this slot empty. */
  topBar?: ReactNode;
  /** The active route's content — a consuming app's root route renders
   * `<AppShell navItems={...}><Outlet /></AppShell>`. */
  children: ReactNode;
}

export function AppShell({ navItems, brand, topBar, children }: AppShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      {topBar}
      <div className="flex flex-1">
        <aside className="flex w-60 shrink-0 flex-col gap-6 border-r border-border bg-muted/30 p-4">
          {brand !== undefined && <div className="text-sm font-semibold">{brand}</div>}
          <nav aria-label="Main">
            <ul className="flex flex-col gap-1">
              {navItems.map((item) => (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent"
                    activeProps={{ className: 'bg-accent font-medium', 'aria-current': 'page' }}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
