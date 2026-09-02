/**
 * The frame every routed screen renders inside: a nav landmark down the
 * side, a main landmark for the active route's content. [8.9.1]'s job was
 * routing/code-splitting; [8.9.7] adds the skip link and the `<main>`'s
 * `id`/`tabIndex` that both it and `useRouteFocus` (`../hooks/use-route-
 * focus.ts`) depend on — the skip link is rendered as this component's
 * very first child, above even `topBar`, so it's the first Tab stop on
 * every page regardless of what's in that slot. [8.9.5]'s tenant/role bar is the
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
import { cn } from '../primitives/lib/utils';

import { Button } from './button';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from './dialog';
import { SkipLink } from './skip-link';

/** `id` of the `<main>` landmark below — exported so `useRouteFocus`
 * (`../hooks/use-route-focus.ts`) targets the same element this
 * component renders, rather than each side hand-maintaining its own
 * copy of the string. */
export const APP_SHELL_MAIN_ID = 'main-content';

/** CSS custom property carrying the live pixel height of the sticky header
 * row. Written onto `document.documentElement` by `AppShell`; stays `0px`
 * when no shell is mounted (`/login`, `/select-school`). Import this
 * rather than retyping the string — [8.14.5] anchors its post-
 * `transition.finished` focus scroll on the same value, and
 * `ui/src/styles/globals.css`'s `scroll-padding-top`/`scroll-margin-top`
 * rules read it too. */
export const APP_HEADER_HEIGHT_VAR = '--app-header-h';

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
  /** Visible micro-heading rendered directly above `pinnedItems` — e.g.
   * "Quick actions". The caller passes an already-translated string (`ui/`
   * wrappers do not call `t()` themselves; see `ui/CONTRIBUTING.md`'s "i18n
   * rules"). Omitted → the pinned run is introduced by nothing but the
   * [8.9.6] hairline that separates it from `items`, so existing callers
   * render exactly as before. The hairline is drawn either way. */
  pinnedLabel?: string;
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
  /** Visible text for the [8.9.7] skip link — "Skip to main content" in
   * English. A literal English fallback, like `openMenuLabel`'s default
   * below: `ui`'s own wrapper components don't call `t()` themselves yet
   * (see `ui/CONTRIBUTING.md`'s "i18n rules"), so a caller that doesn't
   * pass a translated string gets readable English rather than nothing. */
  skipLinkLabel?: string;
  /** [5.2]'s opt-in mobile bottom bar — pass a `BottomNav`
   * (`./bottom-nav.tsx`). When provided, the slot is pinned to the bottom
   * of the viewport below `md`, and `<main>` gets bottom padding (inclusive
   * of the safe-area inset) so content can scroll clear of it.
   *
   * [8.14.3]: providing `bottomNav` alone no longer removes the `<md`
   * header-bar + hamburger drawer — the portal (no `mobileHeaderActions`)
   * still drops it exactly as before, but a caller that also passes
   * `mobileHeaderActions` (staff) keeps both: the drawer is where the full
   * destination list still lives, `BottomNav`'s own `more` cell is what
   * opens it. See `showMobileHeader` below and `app-shell.test.tsx`'s
   * portal-regression-lock case, which pins the old portal-only behaviour
   * byte-for-byte. */
  bottomNav?: ReactNode;
  /** [8.14.3] Rendered between `brand` and the hamburger trigger in the
   * `<md` header row — e.g. a search launcher and a notification bell.
   * Passing this (even alongside `bottomNav`) keeps the header row and its
   * drawer rendering; see `bottomNav`'s own comment. Omitted by every
   * caller that doesn't need one — the portal today. */
  mobileHeaderActions?: ReactNode;
  /** [8.14.3] Rendered inside the drawer `DialogContent`, above the nav
   * landmark — e.g. the staff `TenantBar` plus its own controls, so
   * switching school or role stays one tap away even though the `<md`
   * header row no longer carries `topBar`'s content directly. */
  drawerHeader?: ReactNode;
  /** The active route's content — a consuming app's root route renders
   * `<AppShell navItems={...}><Outlet /></AppShell>`. */
  children: ReactNode;
}

/** [8.14.3] Lets a descendant (`BottomNav`'s `more` cell) open the same
 * drawer the `<md` header's hamburger does, without `AppShell` needing to
 * accept an imperative ref or `BottomNav` needing to reach back up through
 * a prop no other caller would ever pass. Default is an inert no-op so
 * `BottomNav` still renders standalone — in Storybook, in its own unit
 * tests — without an `AppShell` ancestor. */
export interface AppShellDrawerValue {
  open: () => void;
  isOpen: boolean;
}

const AppShellDrawerContext = React.createContext<AppShellDrawerValue>({
  open: () => {},
  isOpen: false,
});

export function useAppShellDrawer(): AppShellDrawerValue {
  return React.useContext(AppShellDrawerContext);
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
        className="relative flex items-center gap-2 rounded-md py-2 ps-6 pe-3 text-sm transition-colors duration-(--motion-duration-fast) ease-(--motion-ease-standard) focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        activeProps={{
          className:
            'bg-primary/10 font-semibold text-primary before:absolute before:inset-y-1 before:start-3 before:w-0.5 before:rounded-full before:bg-primary',
          'aria-current': 'page',
        }}
        inactiveProps={{ className: 'text-muted-foreground hover:bg-accent hover:text-foreground' }}
      >
        {/* [8.14.1] The wrapper — not the caller — is what guarantees the epic's
            "every nav icon is aria-hidden" AC. Call sites also pass
            `aria-hidden` on the icon itself, but a caller that forgets is
            still covered here, and the icon is decorative in every case
            because the link's own text is its accessible name. */}
        {item.icon !== undefined && (
          <span aria-hidden="true" className="contents">
            {item.icon}
          </span>
        )}
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
        className="flex w-full items-center justify-between rounded-md px-3 pt-4 pb-1 text-sm font-semibold tracking-wide text-foreground hover:bg-accent"
      >
        <span>{group.label}</span>
        {collapsed ? (
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        ) : (
          <ChevronDownIcon className="size-4" aria-hidden="true" />
        )}
      </button>
      <ul
        id={panelId}
        hidden={collapsed}
        className="relative flex flex-col gap-1 before:absolute before:inset-y-0 before:start-3 before:w-px before:bg-border-subtle"
      >
        {pinned.length > 0 && group.pinnedLabel !== undefined && (
          <li
            aria-hidden="true"
            className="mb-1 ps-6 text-caption font-medium tracking-wide text-muted-foreground"
          >
            {group.pinnedLabel}
          </li>
        )}
        {pinned.map((item) => (
          <NavLink key={`${item.to}:${item.label}`} item={item} onNavigate={onNavigate} />
        ))}
        {pinned.length > 0 && rest.length > 0 && (
          <li aria-hidden="true" className="my-1 border-t border-border-subtle" />
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
  skipLinkLabel = 'Skip to main content',
  bottomNav,
  mobileHeaderActions,
  drawerHeader,
  children,
}: AppShellProps) {
  const role = useActiveRole();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  // `Boolean`, not `!== undefined`: `ReactNode` admits `null` and `false`,
  // so a caller writing `bottomNav={showBar && <BottomNav />}` would
  // otherwise pass the presence check while rendering nothing — hiding the
  // `<md` drawer and leaving that viewport with no navigation at all.
  const hasBottomNav = Boolean(bottomNav);
  // [8.14.3]: the header row (and its drawer) is dropped only for a
  // `bottomNav`-only caller (the portal, today) — a caller that also hands
  // over `mobileHeaderActions` (staff) keeps it, since that's the only
  // place those actions and the "More" drawer have anywhere to render.
  // `mobileHeaderActions !== undefined` rather than `Boolean(...)`: an
  // empty fragment is still "I want the row", unlike `bottomNav`'s
  // false/null case above where nothing at all would be left to open.
  const showMobileHeader = !hasBottomNav || mobileHeaderActions !== undefined;
  const headerRef = React.useRef<HTMLDivElement>(null);
  const hasTopBar = topBar !== undefined;
  const drawerContextValue = React.useMemo<AppShellDrawerValue>(
    () => ({ open: () => setDrawerOpen(true), isOpen: drawerOpen }),
    [drawerOpen],
  );

  // Keeps `--app-header-h` (`APP_HEADER_HEIGHT_VAR`) in sync with the
  // sticky header row's actual rendered height, live — a `ResizeObserver`
  // rather than a one-shot measurement because the row's height is not
  // fixed: it wraps onto two lines below `md` (`TenantBar`'s
  // `flex-wrap`), and a locale switch can change `TenantBar`'s text
  // length enough to wrap or unwrap. Written onto `document.documentElement`,
  // not this component's own root — `scroll-padding-top` only takes effect
  // on the *scroll container*, which is `<html>` here (the shell itself is
  // `min-h-screen`, the page scrolls at the root), so a variable written
  // anywhere else would leave `:root { scroll-padding-top: … }` reading
  // `0px` forever. Same precedent `theme-provider.tsx` already sets by
  // writing theme state onto `documentElement` rather than a local ref.
  React.useLayoutEffect(() => {
    if (!hasTopBar) return undefined;
    const node = headerRef.current;
    if (!node) return undefined;

    function setHeightVar(height: number): void {
      document.documentElement.style.setProperty(APP_HEADER_HEIGHT_VAR, `${height}px`);
    }

    setHeightVar(node.getBoundingClientRect().height);

    // `ui:node`/older test environments may not implement `ResizeObserver`
    // (`jsdom` did not until relatively recently) — same
    // `typeof X === 'function'` guard `theme-provider.tsx:135` uses for
    // `matchMedia`, so a missing API degrades to "static height on mount"
    // rather than throwing.
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setHeightVar(entry.contentRect.height);
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(APP_HEADER_HEIGHT_VAR);
    };
  }, [hasTopBar]);

  return (
    <AppShellDrawerContext.Provider value={drawerContextValue}>
      <div className="flex min-h-screen flex-col">
        <SkipLink targetId={APP_SHELL_MAIN_ID}>{skipLinkLabel}</SkipLink>
        {hasTopBar && (
          <div ref={headerRef} data-app-header className="sticky top-0 z-30">
            {topBar}
          </div>
        )}
        <div className="flex flex-1 flex-col md:flex-row">
          {showMobileHeader && (
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle p-2 md:hidden">
              {brand !== undefined && <div className="truncate text-sm font-semibold">{brand}</div>}
              {mobileHeaderActions}
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
                  {drawerHeader}
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
          )}

          {/* [8.14.1] `md:sticky md:top-0 md:max-h-svh` makes the sidebar scroll
              on its own instead of scrolling away with the page. [8.14.2]
              (sticky header) will adjust `md:top-0` to the header's height
              once that lands — this ticket owns only this `<aside>`, it does
              not make `topBar` sticky. */}
          <aside className="hidden w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border-subtle bg-muted/30 p-4 md:sticky md:top-0 md:flex md:max-h-svh">
            {brand !== undefined && <div className="text-sm font-semibold">{brand}</div>}
            <NavContent navItems={navItems} navGroups={navGroups} role={role} navLabel={navLabel} />
          </aside>

          {/* `tabIndex={-1}`: not a Tab stop itself, but focusable via the
              skip link's `href="#main-content"` jump and via `useRouteFocus`'s
              no-heading fallback — no `outline-none` here, a jump like this
              should show the same visible focus ring any other target does
              (WCAG 2.4.7). */}
          <main
            id={APP_SHELL_MAIN_ID}
            tabIndex={-1}
            className={cn(
              'min-w-0 flex-1 p-6',
              hasBottomNav && 'pb-[calc(6rem+var(--safe-area-bottom))] md:pb-6',
            )}
          >
            {children}
          </main>
        </div>
        {hasBottomNav && <div className="sticky bottom-0 z-10 md:hidden">{bottomNav}</div>}
      </div>
    </AppShellDrawerContext.Provider>
  );
}
