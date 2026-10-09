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
 *
 * `installItem` follows the same `ReactNode` slot pattern as
 * `profileItem`, for the same reason — [15.8.3]'s "Install app" row needs
 * `useInstallPrompt()` (`@biddaloy/ui/pwa`) and app-specific click
 * behaviour (call `install()`, or open the iOS instructions sheet), none
 * of which belongs in this route-agnostic component. `staff-user-menu.tsx`
 * does that wiring, same as it already does for sign out and the profile
 * placeholder.
 */
import {
  ArrowLeftRightIcon,
  CircleUserRoundIcon,
  LanguagesIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { SUPPORTED_LOCALES, useTranslation } from '../i18n';

import { Button } from './button';
import { useLocaleSwitch } from './locale-switcher';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
} from './menu';
import { useTenantSwitch } from './tenant-bar';
import { useThemeSwitch } from './theme-toggle';

const ROW = 'min-h-11 gap-2.5 px-3';

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
  /** Consumer-owned "Install app" row — `ui/` cannot know install state or
   * how to trigger it. Rendered between the identity block (and
   * `profileItem`, if present) and Sign out. */
  installItem?: ReactNode;
  /** D12: adds Language, Theme and "Switch school or role" to this menu and shows
   * "role · school" under the name. Off by default so existing callers keep their menu. */
  showAccountControls?: boolean;
  onSignOut: () => void;
  signingOut?: boolean;
}

export function UserMenu({
  name,
  roleLabel,
  profileItem,
  installItem,
  showAccountControls = false,
  onSignOut,
  signingOut = false,
}: UserMenuProps) {
  const { t } = useTranslation('nav');
  const displayName = name ?? t('userMenu.loadingName');
  // Hooks run unconditionally; they are cheap and only read when `showAccountControls`.
  const lang = useLocaleSwitch();
  const themeSwitch = useThemeSwitch();
  const tenant = useTenantSwitch();
  const second = showAccountControls
    ? tenant.active
      ? `${tenant.roleLabel(tenant.active.role)} · ${tenant.activeName}`
      : roleLabel
    : roleLabel;

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            iconOnly
            className="size-11 md:size-9"
            aria-label={name ? `${t('userMenu.label')} — ${name}` : t('userMenu.label')}
          >
            <CircleUserRoundIcon />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel className="flex flex-col">
            <span className="font-semibold text-foreground">{displayName}</span>
            {second !== undefined && second !== '' && (
              <span className="font-normal text-muted-foreground">{second}</span>
            )}
          </MenuLabel>
          <MenuSeparator />
          {showAccountControls && (
            <>
              <MenuSub>
                <MenuSubTrigger className={ROW}>
                  <LanguagesIcon aria-hidden="true" />
                  {t('language.groupLabel')}
                  <span className="ms-auto text-text-secondary">{lang.label(lang.locale)}</span>
                </MenuSubTrigger>
                <MenuSubContent>
                  <MenuRadioGroup value={lang.locale} onValueChange={lang.choose}>
                    {SUPPORTED_LOCALES.map((code) => (
                      <MenuRadioItem key={code} value={code} className={ROW}>
                        {lang.label(code)}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuSubContent>
              </MenuSub>
              <MenuSub>
                <MenuSubTrigger className={ROW}>
                  {themeSwitch.isDark ? (
                    <MoonIcon aria-hidden="true" />
                  ) : (
                    <SunIcon aria-hidden="true" />
                  )}
                  {t('theme.groupLabel')}
                  <span className="ms-auto text-text-secondary">
                    {t(`theme.${themeSwitch.preference}`)}
                  </span>
                </MenuSubTrigger>
                <MenuSubContent>
                  <MenuRadioGroup value={themeSwitch.preference} onValueChange={themeSwitch.choose}>
                    <MenuRadioItem value="light" className={ROW}>
                      <SunIcon aria-hidden="true" />
                      {t('theme.light')}
                    </MenuRadioItem>
                    <MenuRadioItem value="dark" className={ROW}>
                      <MoonIcon aria-hidden="true" />
                      {t('theme.dark')}
                    </MenuRadioItem>
                    <MenuRadioItem value="system" className={ROW}>
                      <MonitorIcon aria-hidden="true" />
                      {t('theme.system')}
                    </MenuRadioItem>
                  </MenuRadioGroup>
                </MenuSubContent>
              </MenuSub>
            </>
          )}
          {/* The slot brings its own separator with it. Rendering one on each
            side unconditionally would paint two stacked rules whenever
            `profileItem` is omitted — which is most of this component's own
            stories, and any consumer that has no profile destination. */}
          {(profileItem !== undefined || (showAccountControls && tenant.canSwitch)) && (
            <>
              {profileItem}
              {showAccountControls && tenant.canSwitch && (
                <MenuSub>
                  <MenuSubTrigger className={ROW}>
                    <ArrowLeftRightIcon aria-hidden="true" />
                    {t('tenantBar.switchSchoolOrRole')}
                  </MenuSubTrigger>
                  <MenuSubContent>
                    {tenant.otherSchools.length > 0 && (
                      <>
                        <MenuLabel>{t('tenantBar.switchSchool')}</MenuLabel>
                        {tenant.otherSchools.map((m) => (
                          <MenuItem
                            key={`${m.tenantId}:${m.role}`}
                            className={ROW}
                            onSelect={() => tenant.request(m)}
                          >
                            {tenant.schoolLabel(m)}
                          </MenuItem>
                        ))}
                      </>
                    )}
                    {tenant.rolesHere.length > 0 && (
                      <>
                        <MenuLabel>{t('tenantBar.switchRole')}</MenuLabel>
                        {tenant.rolesHere.map((m) => (
                          <MenuItem
                            key={`${m.tenantId}:${m.role}`}
                            className={ROW}
                            onSelect={() => tenant.request(m)}
                          >
                            {tenant.roleLabel(m.role)}
                          </MenuItem>
                        ))}
                      </>
                    )}
                  </MenuSubContent>
                </MenuSub>
              )}
              <MenuSeparator />
            </>
          )}
          {/* Same "slot brings its own separator" rule as `profileItem`
            above — most stories/consumers render neither. */}
          {installItem !== undefined && (
            <>
              {installItem}
              <MenuSeparator />
            </>
          )}
          <MenuItem
            variant="destructive"
            onSelect={onSignOut}
            disabled={signingOut}
            className={showAccountControls ? ROW : undefined}
          >
            <LogOutIcon aria-hidden="true" />
            {signingOut ? t('userMenu.signingOut') : t('userMenu.signOut')}
          </MenuItem>
        </MenuContent>
      </Menu>
      {showAccountControls && (
        <>
          <span className="sr-only" aria-live="polite">
            {lang.announcement}
          </span>
          <span className="sr-only" aria-live="polite">
            {themeSwitch.announcement}
          </span>
          {tenant.overlay}
        </>
      )}
    </>
  );
}
