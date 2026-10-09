/**
 * Wires `@biddaloy/ui`'s route-agnostic `UserMenu` to this app's actual
 * data and navigation — `ui/` cannot know the route tree or how to sign
 * out (see `user-menu.tsx`'s own header comment), so this app-level
 * component supplies: the fetched name (`useCurrentUser`), the active
 * role's translated label, and the sign-out handler.
 *
 * The account menu (D12) holds language, theme, security, switch school or
 * role and sign out. There is deliberately no "profile — coming soon" row:
 * "My account" is the security page (`securityTo`, `/portal/account` for the
 * portal).
 *
 * A `/users/me` failure must never take Sign out down with it — `name` is
 * simply `undefined` on `isError`, same as while `isLoading`, so
 * `UserMenu`'s own loading-fallback path covers both without this
 * component needing to distinguish them.
 *
 * **[15.8.3] Install app.** `useInstallPrompt()` (`@biddaloy/ui/pwa`) is
 * the only source of truth for whether an install action exists —
 * `mode === 'none'` (already installed, or nothing to offer) renders no
 * `installItem` at all, same "omit the slot value" convention. `mode === 'prompt'` (Chrome/Android/desktop)
 * calls `install()` directly from the menu item's `onSelect`; `mode ===
 * 'ios-instructions'` opens `IosInstallSheet` instead, since iOS has no
 * native prompt to trigger (see that component's own header comment).
 */
import { MenuItem, UserMenu } from '@biddaloy/ui/components';
import { logout, useActiveRole, useCurrentUser } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { IosInstallSheet, useInstallPrompt } from '@biddaloy/ui/pwa';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { DownloadIcon } from 'lucide-react';
import * as React from 'react';

export function StaffUserMenu({ securityTo = '/security' }: { securityTo?: string } = {}) {
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
  // Not destructured as `{ install }` — `@typescript-eslint/unbound-method`
  // flags pulling a method off an object into a bare reference, even one
  // returned from a hook and already `useCallback`-stable. Keeping it on
  // `installPrompt.install(...)` at the call site avoids that trap.
  const installPrompt = useInstallPrompt();
  const { mode } = installPrompt;
  const [iosSheetOpen, setIosSheetOpen] = React.useState(false);

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
    <>
      <UserMenu
        name={isError ? undefined : data?.full_name}
        roleLabel={roleLabel}
        onSignOut={() => void handleSignOut()}
        signingOut={signingOut}
        installItem={
          mode === 'none' ? undefined : (
            <MenuItem
              onSelect={() => {
                if (mode === 'ios-instructions') {
                  setIosSheetOpen(true);
                } else {
                  void installPrompt.install();
                }
              }}
            >
              <DownloadIcon aria-hidden="true" />
              {t('installPrompt.menuItem')}
            </MenuItem>
          )
        }
        showAccountControls
        profileItem={
          // [12.8] — `/security` is gated only by `DASHBOARD_VIEW` (see
          // `route-permissions.ts`'s own comment on that route).
          <MenuItem onSelect={() => void navigate({ to: securityTo })}>
            {t('userMenu.security')}
          </MenuItem>
        }
      />
      {mode === 'ios-instructions' && (
        <IosInstallSheet open={iosSheetOpen} onOpenChange={setIosSheetOpen} />
      )}
    </>
  );
}
