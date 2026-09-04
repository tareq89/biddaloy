/**
 * The persistent tenant/role text [8.9.5]'s AC asks for — "not a value
 * hidden inside a dropdown that must be opened to read." Self-contained
 * like `locale-switcher.tsx` (own header comment explains why a shell-
 * level widget in `ui/` stays standalone rather than threading props
 * through a consumer's app shell): reads the active tenant/role and every
 * membership straight off `auth-state.ts`/the decoded access token, and
 * owns its own `useQueryClient()` for the one thing switching a tenant
 * always needs — `tenant.ts`'s `switchActiveTenant`.
 *
 * The living version of the "Biddaloy Client UI" design project's
 * `templates/school-picker` mockup's top-bar/switch-confirm cells
 * (approved for [8.9.5] — see `ui/CONTRIBUTING.md`'s "Design before you
 * build").
 *
 * Renders nothing before an active tenant is chosen — that moment is
 * `/select-school`'s job (`client-admin/src/routes/select-school.tsx`),
 * reached chrome-free, before `AppShell`/this component ever mount.
 *
 * `useActiveTenant()`/`useAccessToken()` (`hooks/auth-state.ts`), not a
 * fresh `getActiveTenant()`/`getAccessToken()` read on every render: this
 * component isn't the only consumer of the active tenant/role any more
 * (`__root.tsx`'s `RootLayout` also derives nav visibility from it via
 * `useHasPermission`), so a switch here has to be visible everywhere, not
 * just update this component's own local state the way `confirmSwitch`
 * used to.
 */
import type { UserRole } from '@biddaloy/shared';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

import { decodeAccessTokenMemberships } from '../api';
import { useAccessToken, useActiveRole, useActiveTenant } from '../hooks/auth-state';
import { switchActiveTenant } from '../hooks/tenant';
import { useTranslation } from '../i18n';

import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';
import { Menu, MenuContent, MenuItem, MenuLabel, MenuTrigger } from './menu';

interface SchoolOption {
  tenantId: string;
  name?: string;
  role: UserRole;
}

/** A membership's identity is the `{tenantId, role}` pair — see
 * `school-picker.tsx`'s `optionKey` for the same rule and why it exists.
 * Used here for React keys and for "which membership is the active one",
 * both of which were tenant-only before [8.9.11] and so collapsed a
 * dual-role membership at one school into a single entry. */
function membershipKey(m: SchoolOption): string {
  return `${m.tenantId}:${m.role}`;
}

export function TenantBar() {
  const { t } = useTranslation('nav');
  // Role names live in `auth.json` (`schoolPicker.roles.*`) because
  // `school-picker.tsx` translated them first; [8.9.11] makes them
  // load-bearing here too — a same-school switch is labelled by role
  // alone — so this reuses those keys rather than the title-casing
  // English-only fallback it used to carry. A second `useTranslation`
  // call (not `{ ns: 'auth' }` on a `nav` `t`) so i18next actually loads
  // the namespace, and so `check-i18n-keys.mjs` still resolves this
  // file's bare keys to `nav` off the *first* call (see its own comment
  // on per-file namespace resolution).
  const { t: tAuth } = useTranslation('auth');
  const queryClient = useQueryClient();
  const activeTenantId = useActiveTenant();
  const activeRole = useActiveRole();
  const token = useAccessToken();
  const [pendingSwitch, setPendingSwitch] = React.useState<SchoolOption | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  const memberships: SchoolOption[] = token ? decodeAccessTokenMemberships(token) : [];
  // Tenant *and* role: with two memberships at one school, matching on
  // tenant alone would always report the first one as active, whichever
  // role the user actually switched to. `activeRole` can legitimately be
  // null for a moment on a cold render before the session bootstrap sets
  // it — fall back to tenant-only rather than blanking the whole bar.
  const active = memberships.find(
    (m) =>
      m.tenantId === activeTenantId && (activeRole === null || (m.role as string) === activeRole),
  );

  // Nothing to show before a tenant is chosen, or if the decoded token
  // and the active tenant briefly disagree (a stale render mid-navigation)
  // — never render a half-correct chip.
  if (!active) return null;

  // A stale token from before `JwtMembership.name` existed (or issued just
  // before a rename propagated) can still be valid for up to its remaining
  // lifetime — fall back rather than render blank text.
  const unnamedSchool = t('tenantBar.unnamedSchool');
  const activeName = active.name ?? unnamedSchool;
  const activeKey = membershipKey(active);
  // Two seams, not one: another *school* versus another *role at this
  // school*. The pre-[8.9.11] filter was `m.tenantId !== activeTenantId`,
  // which excludes every same-school membership — so the one user this
  // switcher exists for, a dual-role ADMIN/PARENT at a single school, got
  // a menu with nothing in it and no way back to their other role.
  const otherSchools = memberships.filter((m) => m.tenantId !== activeTenantId);
  const rolesHere = memberships.filter(
    (m) => m.tenantId === activeTenantId && membershipKey(m) !== activeKey,
  );

  const roleLabel = (role: string): string => tAuth(`schoolPicker.roles.${role}`);
  /** Another school is normally named by its name alone. If the user holds
   * more than one role *there* too, the name alone would render the same
   * text twice — an ambiguous accessible name for two menu items that do
   * different things — so the role disambiguates it. */
  const schoolLabel = (m: SchoolOption): string => {
    const name = m.name ?? unnamedSchool;
    const multiRole = memberships.filter((x) => x.tenantId === m.tenantId).length > 1;
    return multiRole ? t('tenantBar.schoolWithRole', { name, role: roleLabel(m.role) }) : name;
  };

  /** A same-school role change is the one switch where the school name says
   * nothing useful — the confirm copy names the role instead. */
  const isRoleSwitch = pendingSwitch !== null && pendingSwitch.tenantId === activeTenantId;
  const pendingRoleLabel = pendingSwitch ? roleLabel(pendingSwitch.role) : '';

  function confirmSwitch(): void {
    if (!pendingSwitch) return;
    switchActiveTenant(queryClient, pendingSwitch.tenantId, pendingSwitch.role);
    const name = pendingSwitch.name ?? unnamedSchool;
    setAnnouncement(
      pendingSwitch.tenantId === activeTenantId
        ? t('tenantBar.switchedRole', { role: roleLabel(pendingSwitch.role) })
        : t('tenantBar.switched', { name }),
    );
    setPendingSwitch(null);
  }

  const canSwitch = otherSchools.length > 0 || rolesHere.length > 0;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="truncate font-semibold text-foreground">{activeName}</span>
      <span className="text-muted-foreground">{roleLabel(active.role)}</span>
      {canSwitch && (
        <Menu>
          <MenuTrigger asChild>
            <Button variant="outline" size="sm">
              {rolesHere.length > 0
                ? t('tenantBar.switchSchoolOrRole')
                : t('tenantBar.switchSchool')}
            </Button>
          </MenuTrigger>
          <MenuContent align="end">
            {otherSchools.length > 0 && (
              <>
                <MenuLabel>{t('tenantBar.switchSchool')}</MenuLabel>
                {otherSchools.map((school) => (
                  <MenuItem key={membershipKey(school)} onSelect={() => setPendingSwitch(school)}>
                    {schoolLabel(school)}
                  </MenuItem>
                ))}
              </>
            )}
            {rolesHere.length > 0 && (
              <>
                <MenuLabel>{t('tenantBar.switchRole')}</MenuLabel>
                {rolesHere.map((membership) => (
                  <MenuItem
                    key={membershipKey(membership)}
                    onSelect={() => setPendingSwitch(membership)}
                  >
                    {roleLabel(membership.role)}
                  </MenuItem>
                ))}
              </>
            )}
          </MenuContent>
        </Menu>
      )}

      <Dialog
        open={pendingSwitch !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSwitch(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {isRoleSwitch
                ? t('tenantBar.confirmRoleTitle', { role: pendingRoleLabel })
                : t('tenantBar.confirmTitle', { name: pendingSwitch?.name ?? unnamedSchool })}
            </DialogTitle>
            <DialogDescription>
              {isRoleSwitch
                ? t('tenantBar.confirmRoleDescription', { current: roleLabel(active.role) })
                : t('tenantBar.confirmDescription', { current: activeName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t('tenantBar.cancel')}</Button>
            </DialogClose>
            <Button onClick={confirmSwitch}>
              {isRoleSwitch ? t('tenantBar.confirmRole') : t('tenantBar.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
