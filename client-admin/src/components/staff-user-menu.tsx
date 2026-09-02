/**
 * Wires `@biddaloy/ui`'s route-agnostic `UserMenu` to this app's actual
 * data and navigation — `ui/` cannot know the route tree or how to sign
 * out (see `user-menu.tsx`'s own header comment), so this app-level
 * component supplies: the fetched name (`useCurrentUser`), the active
 * role's translated label, and the sign-out handler.
 *
 * **Profile placeholder — user-approved deviation from the published
 * plan.** The plan's own "Needs decision" section picked option (a): ship
 * name/role/Sign out and leave `profileItem` unset, since no staff
 * profile route exists yet (`#368` only builds the guardian-facing
 * `/portal/account`). The user overrode that for this ticket: a disabled
 * `MenuItem` renders here instead, communicating "not built yet" rather
 * than omitting the row outright — the epic's own header mockup shows a
 * profile entry, so a silent absence would read as a missing feature
 * rather than a deliberate one. This placeholder is deliberately **not**
 * baked into `@biddaloy/ui`'s `UserMenu` API — it stays a plain
 * `profileItem` slot value, owned entirely by this app.
 *
 * A `/users/me` failure must never take Sign out down with it — `name` is
 * simply `undefined` on `isError`, same as while `isLoading`, so
 * `UserMenu`'s own loading-fallback path covers both without this
 * component needing to distinguish them.
 */
import { MenuItem, UserMenu } from '@biddaloy/ui/components';
import { logout, useActiveRole, useCurrentUser } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';

export function StaffUserMenu() {
  // Loaded first — `check-i18n-keys.mjs` resolves a file's bare `t()`
  // calls off its *first* `useTranslation` call, so `nav` (this
  // component's own namespace) must be established before `auth` is
  // brought in for the role label below. Same ordering `tenant-bar.tsx`
  // documents at its own two `useTranslation` calls.
  const { t } = useTranslation('nav');
  const { t: tAuth } = useTranslation('auth');
  const { data, isError } = useCurrentUser();
  const role = useActiveRole();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = React.useState(false);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    try {
      await logout(queryClient);
    } finally {
      // `logout()` already clears local auth state/cache in its own
      // `finally` (see `ui/src/hooks/auth.ts`'s comment) even if the
      // network call itself failed — this always navigates away, same
      // as `select-school.tsx`'s own zero-memberships branch.
      void navigate({ to: '/login' });
    }
  }

  // `undefined`, not `''` — an empty string would still render the muted
  // role line, leaving a blank row under the name. `UserMenu` omits the
  // line entirely when the prop is absent.
  const roleLabel = role ? tAuth(`schoolPicker.roles.${role}`) : undefined;

  return (
    <UserMenu
      name={isError ? undefined : data?.full_name}
      roleLabel={roleLabel}
      onSignOut={() => void handleSignOut()}
      signingOut={signingOut}
      profileItem={
        // `aria-disabled` + a swallowed `onSelect`, not `disabled`: a
        // `disabled` menu item is skipped by the menu's roving focus, so a
        // screen-reader user would never reach the one row that explains
        // the feature is coming — the placeholder would be invisible to
        // exactly the users it is meant to inform. This keeps it
        // focusable and announced while still doing nothing on activation.
        <MenuItem
          aria-disabled="true"
          onSelect={(event) => {
            event.preventDefault();
          }}
          className="text-muted-foreground data-highlighted:text-muted-foreground"
        >
          {t('userMenu.profile')}{' '}
          <span className="text-muted-foreground">({t('userMenu.profileComingSoon')})</span>
        </MenuItem>
      }
    />
  );
}
