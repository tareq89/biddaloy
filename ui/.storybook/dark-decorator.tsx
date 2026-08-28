/**
 * Shared "dark theme" story decorator.
 *
 * The dark tokens in `globals.css` live behind `:root[data-theme="dark"]`,
 * so a class or attribute on a wrapping `<div>` cannot reach them — only the
 * document element can. This decorator sets that attribute on mount and
 * restores the previous value on unmount, exactly as `rtl-decorator.tsx`
 * does for `dir`.
 *
 * [8.13.12] (#353) shipped the real user-facing theme toggle AND a
 * toolbar-driven `theme` global (`preview.tsx`'s `globalTypes.theme`) that
 * every story now renders under. This decorator still exists for a story
 * that must render dark regardless of the toolbar's current setting — a
 * fixed reference/regression story, for instance — while the toolbar is
 * for browsing the whole component tree in one theme at a time.
 *
 * ⚠️ **Do not add `tags: ['autodocs']` to a file that uses this decorator.**
 * The mutation is document-level and cannot be scoped to one story's subtree.
 * Autodocs renders every story of a file on a single page, so one dark story
 * turns the whole docs page — its light siblings, the prose, the Storybook
 * chrome — dark for as long as it is mounted. A file mixing light and dark
 * stories must stay on plain canvas stories until this decorator can scope
 * the theme without touching `document.documentElement`.
 *
 * **The same constraint applies to the toolbar-driven `theme` global too,**
 * for the identical reason — it also has no way to reach dark tokens
 * without setting the attribute on `document.documentElement`, so it also
 * cannot be scoped to one story. An autodocs page renders every story on it
 * in whichever theme the toolbar is currently set to, not just the one a
 * viewer happens to be looking at — flipping the toolbar to dark while
 * viewing an autodocs page silently darkens every story on that page, not
 * a single, chosen one. This is a viewer-visible trade-off, not a bug to
 * fix here: the toolbar's whole purpose is "browse everything in one theme
 * at a time," and per-story theme scoping on an autodocs page is the same
 * open problem this decorator's own restriction already names.
 *
 * ⚠️ **Every story using `darkDecorator` must also spread
 * `darkDecoratorParameters` into its own `parameters`.** The toolbar's
 * preview-level theme decorator (`preview.tsx`) sets
 * `document.documentElement.dataset.theme` on every story unconditionally
 * unless `parameters.theme === 'fixed'`; without that opt-out, flipping the
 * toolbar to light while viewing one of these fixed-dark stories fights this
 * decorator's own effect for control of the same DOM attribute — whichever
 * one's effect ran last wins, so the story renders whatever theme the
 * toolbar happened to be on, not the dark one its name promises. This has
 * already broken silently once (a code-review catch after #353 missed 4 of
 * 9 consumers); import the constant below rather than retyping the literal,
 * so a future consumer can't drift from what this decorator actually needs.
 */
import type { Decorator } from '@storybook/react-vite';
import { useEffect } from 'react';

/** Spread into a story's `parameters` alongside `decorators: [darkDecorator]`
 * — see the warning above. A single named export rather than each consumer
 * retyping `{ theme: 'fixed' }` means a future rename of the parameter only
 * has one call site to update, not up to nine. */
export const darkDecoratorParameters = { theme: 'fixed' } as const;

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
