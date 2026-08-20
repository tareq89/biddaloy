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
import { useAccessToken, useActiveTenant } from '../hooks/auth-state';
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

/** Title-cases a role enum key ("TEACHER" -> "Teacher") — not real i18n
 * yet, just a readable fallback (see `ui/CONTRIBUTING.md`'s "i18n rules").
 * `school-picker.tsx`'s equivalent labels are now translated
 * (`schoolPicker.roles.*` in `auth.json`) since a review flagged that file
 * specifically — this copy wasn't in scope for that thread and stays as
 * documented English-only fallback for now. */
function humanizeRole(role: string): string {
  const lower = role.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function TenantBar() {
  const { t } = useTranslation('nav');
  const queryClient = useQueryClient();
  const activeTenantId = useActiveTenant();
  const token = useAccessToken();
  const [pendingSwitch, setPendingSwitch] = React.useState<SchoolOption | null>(null);
  const [announcement, setAnnouncement] = React.useState('');

  const memberships: SchoolOption[] = token ? decodeAccessTokenMemberships(token) : [];
  const active = memberships.find((m) => m.tenantId === activeTenantId);

  // Nothing to show before a tenant is chosen, or if the decoded token
  // and the active tenant briefly disagree (a stale render mid-navigation)
  // — never render a half-correct chip.
  if (!active) return null;

  // A stale token from before `JwtMembership.name` existed (or issued just
  // before a rename propagated) can still be valid for up to its remaining
  // lifetime — fall back rather than render blank text.
  const unnamedSchool = t('tenantBar.unnamedSchool');
  const activeName = active.name ?? unnamedSchool;
  const others = memberships.filter((m) => m.tenantId !== activeTenantId);

  function confirmSwitch(): void {
    if (!pendingSwitch) return;
    switchActiveTenant(queryClient, pendingSwitch.tenantId, pendingSwitch.role);
    setAnnouncement(t('tenantBar.switched', { name: pendingSwitch.name ?? unnamedSchool }));
    setPendingSwitch(null);
  }

  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
      <span className="font-semibold text-foreground">{activeName}</span>
      {memberships.length > 1 && (
        <>
          <span className="text-muted-foreground">{humanizeRole(active.role)}</span>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm">
                {t('tenantBar.switchSchool')}
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuLabel>{t('tenantBar.switchSchool')}</MenuLabel>
              {others.map((school) => (
                <MenuItem key={school.tenantId} onSelect={() => setPendingSwitch(school)}>
                  {school.name ?? unnamedSchool}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </>
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
              {t('tenantBar.confirmTitle', { name: pendingSwitch?.name ?? unnamedSchool })}
            </DialogTitle>
            <DialogDescription>
              {t('tenantBar.confirmDescription', { current: activeName })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="ghost">{t('tenantBar.cancel')}</Button>
            </DialogClose>
            <Button onClick={confirmSwitch}>{t('tenantBar.confirm')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
