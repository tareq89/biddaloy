/**
 * The account menu that lives at the far right of every staff/portal
 * header row — [8.14.2]. Presentational and route-agnostic, same
 * discipline `AppShell`'s own nav items follow (see `ui/src/routes/
 * index.ts`'s comment on why `ui/` can't depend on a specific consuming
 * app's generated route tree): it doesn't fetch the current user, doesn't
 * know how to sign out, and doesn't know what a "profile" link should
 * point at. All three are the caller's job —
 * `client-admin/src/components/staff-user-menu.tsx` does that wiring for
 * this app.
 *
 * `name` is `undefined` while the caller's `/users/me` query hasn't
 * resolved yet (or failed) — the trigger and the menu label both render a
 * loading fallback rather than blocking on the fetch, because losing the
 * only visible sign-out control while a name fetch is slow (or 401s)
 * would be a worse bug than a name that's briefly blank.
 *
 * `profileItem` is a plain `ReactNode` slot, not a typed "profile route"
 * prop — this ticket has no staff profile route to link to yet (see the
 * published plan's "Plan corrections" #2), so the slot exists for
 * whatever a caller wants to render between the identity block and
 * "Sign out": a real link once one exists, or — what
 * `staff-user-menu.tsx` renders today — a disabled placeholder
 * communicating "not built yet".
 */
import { LogOutIcon, UserIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { useTranslation } from '../i18n';

import { Button } from './button';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from './menu';

export interface UserMenuProps {
  /** Display name; `undefined` while the `/users/me` query is in flight
   * (or failed) — renders a loading/fallback state instead. */
  name?: string | undefined;
  /** Already-translated active role, e.g. "Accountant". Omit it when there
   * is no active role to show — passing `''` would still render the muted
   * second line, leaving a blank row under the name. */
  roleLabel?: string | undefined;
  /** Consumer-owned destination(s) — `ui/` cannot know the route tree.
   * Rendered between the identity block and Sign out. */
  profileItem?: ReactNode;
  onSignOut: () => void;
  signingOut?: boolean;
}

export function UserMenu({
  name,
  roleLabel,
  profileItem,
  onSignOut,
  signingOut = false,
}: UserMenuProps) {
  const { t } = useTranslation('nav');
  const displayName = name ?? t('userMenu.loadingName');

  return (
    <Menu>
      <MenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          iconOnly
          aria-label={name ? `${t('userMenu.label')} — ${name}` : t('userMenu.label')}
        >
          <UserIcon />
        </Button>
      </MenuTrigger>
      <MenuContent align="end">
        <MenuLabel className="flex flex-col">
          <span className="font-semibold text-foreground">{displayName}</span>
          {roleLabel !== undefined && roleLabel !== '' && (
            <span className="font-normal text-muted-foreground">{roleLabel}</span>
          )}
        </MenuLabel>
        <MenuSeparator />
        {/* The slot brings its own separator with it. Rendering one on each
            side unconditionally would paint two stacked rules whenever
            `profileItem` is omitted — which is most of this component's own
            stories, and any consumer that has no profile destination. */}
        {profileItem !== undefined && (
          <>
            {profileItem}
            <MenuSeparator />
          </>
        )}
        <MenuItem variant="destructive" onSelect={onSignOut} disabled={signingOut}>
          <LogOutIcon aria-hidden="true" />
          {signingOut ? t('userMenu.signingOut') : t('userMenu.signOut')}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
