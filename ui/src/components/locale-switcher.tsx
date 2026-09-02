/**
 * The interface-language switcher — lives in the staff/portal header row
 * (`AppHeader`'s `end` slot) alongside `ThemeToggle`.
 *
 * Persistence, `<html lang>`/`dir` reflection, and Suspense-safe
 * namespace loading are all `I18nProvider`/`useLocale`'s job already —
 * this component is just the UI on top: a trigger showing the current
 * language, a menu of the other choices, and a screen-reader
 * announcement of the switch (`role="menuitemradio"`'s own `aria-checked`
 * change is announced *inside* the open menu, but nothing announces the
 * result once the menu closes and focus returns to the trigger without
 * this).
 *
 * [8.14.2] i18n's this component's own two remaining English literals
 * (the trigger's `aria-label` and the group label) — following
 * `tenant-bar.tsx`'s precedent of calling `useTranslation('nav')`
 * directly for a shell-level widget, not the English-fallback-prop
 * pattern `NotificationBell` still uses. See `ui/CONTRIBUTING.md`'s
 * "i18n rules" section for the documented exception this and
 * `tenant-bar.tsx` both rely on. Locale *names* (`LOCALE_LABELS`) stay
 * literal — a language's own name isn't translated into other
 * languages, same reasoning `tenant-bar.tsx`'s `LOCALE_LABELS`-style
 * constants never route through `t()`.
 */
import { LanguagesIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { SUPPORTED_LOCALES, useLocale, type Locale } from '../i18n';

import { Button } from './button';
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuTrigger } from './menu';

const LOCALE_LABELS: Record<Locale, string> = {
  bn: 'বাংলা',
  en: 'English',
};

export interface LocaleSwitcherProps {
  /** Where the menu opens relative to the trigger — forwarded to
   * `MenuContent`'s `align`. Defaults to `'end'`, the natural fit for an
   * account-menu-style trigger. */
  align?: React.ComponentProps<typeof MenuContent>['align'];
}

export function LocaleSwitcher({ align = 'end' }: LocaleSwitcherProps) {
  const { t } = useTranslation('nav');
  const { locale, setLocale } = useLocale();
  const [announcement, setAnnouncement] = React.useState('');

  function handleValueChange(value: string): void {
    const next = value as Locale;
    if (next === locale) return;
    setLocale(next);
    setAnnouncement(t('language.announce', { language: LOCALE_LABELS[next] }));
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" iconOnly aria-label={t('language.label')}>
            <LanguagesIcon />
          </Button>
        </MenuTrigger>
        <MenuContent align={align}>
          <MenuLabel>{t('language.groupLabel')}</MenuLabel>
          <MenuRadioGroup value={locale} onValueChange={handleValueChange}>
            {SUPPORTED_LOCALES.map((code) => (
              <MenuRadioItem key={code} value={code}>
                {LOCALE_LABELS[code]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      {/* Announces the switch itself — `role="menuitemradio"`'s `aria-checked`
       * change is only heard while the menu is open; this covers after it
       * closes and focus returns to the trigger. Same pattern as
       * `Button`'s own loading announcement. */}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
