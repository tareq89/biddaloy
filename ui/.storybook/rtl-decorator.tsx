/**
 * Shared "RTL" story decorator — see `button.stories.tsx`'s comment on why
 * this forces `dir="rtl"` directly rather than switching the locale
 * toolbar: neither of this package's two supported locales (`en`, `bn`) is
 * actually RTL, but every component in this issue still needs an RTL story
 * to prove its own layout holds up under a bidi flip.
 */
import type { Decorator } from '@storybook/react';

export const rtlDecorator: Decorator = (StoryFn) => (
  <div dir="rtl">
    <StoryFn />
  </div>
);
