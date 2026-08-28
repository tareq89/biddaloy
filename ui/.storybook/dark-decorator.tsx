/**
 * Shared "dark theme" story decorator.
 *
 * The dark tokens in `globals.css` live behind `:root[data-theme="dark"]`,
 * so a class or attribute on a wrapping `<div>` cannot reach them — only the
 * document element can. This decorator sets that attribute on mount and
 * restores the previous value on unmount, exactly as `rtl-decorator.tsx`
 * does for `dir`.
 *
 * [8.13.12] (#353) ships the real user-facing theme toggle; until then this
 * is the only way a story can render the dark half of a token pair. Later
 * tickets reuse this decorator rather than each rolling their own.
 *
 * ⚠️ **Do not add `tags: ['autodocs']` to a file that uses this decorator.**
 * The mutation is document-level and cannot be scoped to one story's subtree.
 * Autodocs renders every story of a file on a single page, so one dark story
 * turns the whole docs page — its light siblings, the prose, the Storybook
 * chrome — dark for as long as it is mounted. A file mixing light and dark
 * stories must stay on plain canvas stories until this decorator can scope
 * the theme without touching `document.documentElement`.
 */
import type { Decorator } from '@storybook/react-vite';
import { useEffect } from 'react';

// A real (PascalCase) component, not the decorator function itself, so the
// `useEffect` below lives somewhere `react-hooks/rules-of-hooks` recognizes
// as a valid hook context.
function DocumentDarkThemeEffect() {
  useEffect(() => {
    const previousTheme = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'dark';
    return () => {
      if (previousTheme === undefined) {
        delete document.documentElement.dataset.theme;
      } else {
        document.documentElement.dataset.theme = previousTheme;
      }
    };
  }, []);
  return null;
}

export const darkDecorator: Decorator = (StoryFn) => (
  <div className="bg-background p-6 text-foreground">
    <DocumentDarkThemeEffect />
    <StoryFn />
  </div>
);
