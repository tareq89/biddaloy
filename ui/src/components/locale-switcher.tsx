/**
 * The interface-language switcher — meant to live in an app shell's
 * account menu (the epic's own framing) once one exists; a standalone,
 * self-contained component today since app-wide shell/nav adoption is a
 * later ticket's call (`ui/README.md`'s Testing section on why
 * `renderWithProviders`'s provider stack isn't the real app's yet).
 *
 * Persistence, `<html lang>`/`dir` reflection, and Suspense-safe
 * namespace loading are all `I18nProvider`/`useLocale`'s job already —
 * this component is just the UI on top: a trigger showing the current
 * language, a menu of the other choices, and a screen-reader
 * announcement of the switch (`role="menuitemradio"`'s own `aria-checked`
 * changes are announced *inside* an open menu, but nothing announces the
 * result once the menu closes and focus returns to the trigger without
 * this).
 *
 * String literals below (`'Language'`, `'Change language'`, the locale
 * labels) are the same accepted, explained gap every `ui` wrapper carries
 * — see `ui/CONTRIBUTING.md`'s "i18n rules" section; `ui`'s own wrapper
 * layer doesn't consume translation keys, it's where they'd originate for
 * everything else.
 */
import { LanguagesIcon } from 'lucide-react';
import * as React from 'react';

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
   * account-menu-style trigger sitting at the edge of a header. */
  align?: React.ComponentProps<typeof MenuContent>['align'];
}

export function LocaleSwitcher({ align = 'end' }: LocaleSwitcherProps) {
  const { locale, setLocale } = useLocale();
  const [announcement, setAnnouncement] = React.useState('');

  function handleValueChange(value: string) {
    const next = value as Locale;
    if (next === locale) return;
    setLocale(next);
    setAnnouncement(`Language switched to ${LOCALE_LABELS[next]}`);
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" iconOnly aria-label="Change language">
            <LanguagesIcon />
          </Button>
        </MenuTrigger>
        <MenuContent align={align}>
          <MenuLabel>Language</MenuLabel>
          <MenuRadioGroup value={locale} onValueChange={handleValueChange}>
            {SUPPORTED_LOCALES.map((code) => (
              <MenuRadioItem key={code} value={code}>
                {LOCALE_LABELS[code]}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuContent>
      </Menu>
      {/* Announces the switch itself — role="menuitemradio"'s aria-checked
          change is only heard while the menu is open; this covers after it
          closes and focus returns to the trigger. Same pattern as
          Button's own loading announcement. */}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
