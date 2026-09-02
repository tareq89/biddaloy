/**
 * Tri-state theme control — [8.14.2] rebuilds the old two-state
 * light/dark toggle button ([8.13.12]) into a `Menu` + `MenuRadioGroup`,
 * the same shape `LocaleSwitcher` (`./locale-switcher.tsx`) already
 * established for a shell-level tri/multi-choice control. "Follow the
 * system" is now a real, selectable third option — not just the absence
 * of a stored choice — because a header-level control needs to let a user
 * *return* to system-following after having picked light or dark, which
 * a two-state toggle has no way to express.
 *
 * All the actual state (persistence, `prefers-color-scheme` fallback,
 * live OS sync) still lives in `useTheme()` (`ui/src/theme/`); this
 * component is UI only. The trigger icon reflects the **resolved** theme
 * (`SunIcon`/`MoonIcon`), not the preference — a `'system'` preference on
 * a dark-OS visitor shows the moon, same as an explicit `'dark'` choice,
 * because that's what's actually on screen. `MonitorIcon` only appears as
 * the radio item's own icon for the `'system'` choice itself.
 *
 * Following `tenant-bar.tsx`'s precedent (not `LocaleSwitcher`'s
 * English-fallback-prop pattern — see that file's own comment on why):
 * this component calls `useTranslation('nav')` directly, so the epic's
 * i18n acceptance criterion binds to it and `check-i18n-keys.mjs`
 * resolves its bare keys against the `nav` namespace.
 */
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { useTheme } from '../theme/theme-provider';
import type { ThemePreference } from '../theme/theme-storage';

import { Button } from './button';
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './menu';

export function ThemeToggle() {
  const { t } = useTranslation('nav');
  const { theme, preference, setPreference } = useTheme();
  const [announcement, setAnnouncement] = React.useState('');
  const isDark = theme === 'dark';

  function handleValueChange(value: string): void {
    const next = value as ThemePreference;
    if (next === preference) return;
    setPreference(next);
    setAnnouncement(t('theme.announce', { mode: t(`theme.${next}`) }));
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" iconOnly aria-label={t('theme.label')}>
            {isDark ? <SunIcon /> : <MoonIcon />}
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel>{t('theme.groupLabel')}</MenuLabel>
          <MenuRadioGroup value={preference} onValueChange={handleValueChange}>
            <MenuRadioItem value="light">
              <SunIcon aria-hidden="true" />
              {t('theme.light')}
            </MenuRadioItem>
            <MenuRadioItem value="dark">
              <MoonIcon aria-hidden="true" />
              {t('theme.dark')}
            </MenuRadioItem>
            <MenuRadioItem value="system">
              <MonitorIcon aria-hidden="true" />
              {t('theme.system')}
            </MenuRadioItem>
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      {/* Announces the switch itself — same pattern as `LocaleSwitcher`'s
       * own announcer span, see its comment for why: `role="menuitemradio"`'s
       * `aria-checked` change is only heard while the menu is open. */}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
