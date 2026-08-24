/**
 * Shared "RTL" story decorator — see `button.stories.tsx`'s comment on why
 * this forces `dir="rtl"` directly rather than switching the locale
 * toolbar: neither of this package's two supported locales (`en`, `bn`) is
 * actually RTL, but every component in this issue still needs an RTL story
 * to prove its own layout holds up under a bidi flip.
 *
 * Also sets `dir="rtl"` on `document.documentElement`, restoring the prior
 * value on unmount: Radix Dialog/Menu/Select/Tooltip content portals to
 * `document.body`, outside the wrapping `<div>` below, so that div's `dir`
 * alone never reaches portaled content — only the document-level attribute
 * does.
 */
import type { Decorator } from '@storybook/react-vite';
import { useEffect } from 'react';

// A real (PascalCase) component, not the decorator function itself, so the
// `useEffect` below lives somewhere `react-hooks/rules-of-hooks` recognizes
// as a valid hook context — Storybook decorators are plain higher-order
// functions, not components by that rule's naming convention.
function DocumentRtlEffect() {
  useEffect(() => {
    const previousDir = document.documentElement.dir;
    document.documentElement.dir = 'rtl';
    return () => {
      document.documentElement.dir = previousDir;
    };
  }, []);
  return null;
}

export const rtlDecorator: Decorator = (StoryFn) => (
  <div dir="rtl">
    <DocumentRtlEffect />
    <StoryFn />
  </div>
);
