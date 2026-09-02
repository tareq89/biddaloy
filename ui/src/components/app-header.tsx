/**
 * The always-visible staff/portal header row — [8.14.2]. Consolidates
 * what used to be an ad-hoc `<div className="flex flex-wrap …">` each
 * route file (`_staff.tsx`, `portal.tsx`) built by hand around `TenantBar`
 * into one shared, styled row: `start` (identity — `TenantBar`) on the
 * left, `end` (controls — search, notifications, language, theme, user
 * menu) on the right.
 *
 * Owns the border/padding `tenant-bar.tsx` used to own itself — moved
 * here so a route with no `TenantBar` yet (there isn't one today, but
 * nothing stops a future consumer) still gets the same header chrome.
 * `AppShell` (`./app-shell.tsx`) wraps whatever is passed as its `topBar`
 * prop — normally an `<AppHeader>` — in the `position: sticky` layer and
 * measures its height into `--app-header-h`; this component itself knows
 * nothing about stickiness, only about the row's own layout.
 */
import type { ReactNode } from 'react';

export interface AppHeaderProps {
  /** Left side — identity. Typically `<TenantBar />`. */
  start: ReactNode;
  /** Right side — controls, in the epic's mandated order: search,
   * notifications, language, theme, user menu. */
  end: ReactNode;
}

export function AppHeader({ start, end }: AppHeaderProps) {
  return (
    // `<header>` rather than `<div>`: as a direct child of `<body>`'s
    // layout root (not nested inside another sectioning element) this is an
    // implicit `banner` landmark, which is what lets screen-reader users
    // jump to the site chrome. `AppShell` renders exactly one of these.
    <header
      className="flex min-h-(--control-h) w-full items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle bg-background px-4 py-2 text-sm"
      data-app-header-row
    >
      <div className="flex min-w-0 items-center gap-3">{start}</div>
      {/* `shrink-0`: the controls are fixed-size icon buttons, so at 320px
          the identity side must absorb the squeeze (it has `min-w-0` and
          truncates) rather than the controls deforming. */}
      <div className="flex shrink-0 items-center gap-1">{end}</div>
    </header>
  );
}
