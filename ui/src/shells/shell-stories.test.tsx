/**
 * A `meta.decorators` `MemoryRouter` plus a per-story `decorators`
 * `MemoryRouter` (for a story that needs its own `initialEntries`) nest
 * two Routers — react-router throws "You cannot render a <Router> inside
 * another <Router>" the moment such a story is actually rendered. A
 * static `storybook build` never catches this, since it doesn't execute
 * stories; `WithSelection`/`FilteredAndSorted` (list-shell) and
 * `DeepLinkedTab` (detail-shell) all shipped with exactly this bug
 * before it was caught during a later PR's review. This smoke-renders
 * every exported story from every `*.stories.tsx` file in this
 * directory so a future shell's story file regresses the same way here,
 * not in production.
 */
import { composeStories } from '@storybook/react';
import { render } from '@testing-library/react';
import * as React from 'react';
import { describe, it } from 'vitest';

const storyModules = import.meta.glob('./*.stories.tsx', { eager: true });

for (const [path, storyModule] of Object.entries(storyModules)) {
  describe(path, () => {
    const stories: Record<string, React.ComponentType> = composeStories(storyModule as never);
    for (const [name, Story] of Object.entries(stories)) {
      it(`${name} renders without throwing`, () => {
        render(<Story />);
      });
    }
  });
}
