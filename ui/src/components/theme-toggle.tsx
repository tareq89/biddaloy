/**
 * Dark-mode toggle — [8.13.12]'s user-facing switch for the token pairs
 * `globals.css`'s `:root[data-theme="dark"]` block has carried since
 * [8.1.2]. All the actual state (persistence, `prefers-color-scheme`
 * fallback, live OS sync) lives in `useTheme()` (`ui/src/theme/`); this
 * component is UI only, in the same spirit as `LocaleSwitcher` right next
 * to it.
 *
 * A single icon button, not a menu — there are only two rendered states
 * (`light`/`dark`; "follow the system" is the absence of a stored choice,
 * not a third UI option, see `theme-storage.ts`'s own comment). The icon
 * and accessible name both name the theme a click switches *to*, not the
 * one currently active: a moon while light ("Switch to dark theme"), a sun
 * while dark ("Switch to light theme"). `aria-pressed` still reflects
 * whether dark is *currently* active, so assistive tech gets both signals —
 * the name describes the action, the pressed state describes the outcome
 * of the last one.
 *
 * String literals below are the same accepted, documented gap every `ui`
 * wrapper carries today — see `ui/CONTRIBUTING.md`'s "i18n rules" section
 * and `LocaleSwitcher`'s own comment: `ui`'s wrapper layer doesn't consume
 * translation keys yet, real i18n enforcement is scoped to `client-admin`
 * only ([8.7.4]).
 */
import { MoonIcon, SunIcon } from 'lucide-react';

import { useTheme } from '../theme/theme-provider';

import { Button } from './button';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <Button
      variant="ghost"
      size="icon"
      iconOnly
      aria-label={label}
      aria-pressed={isDark}
      onClick={toggleTheme}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
