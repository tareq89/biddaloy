import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { ThemeToggle } from './theme-toggle';

/**
 * [8.14.2] rebuilt this from a two-state `aria-pressed` flip button into a
 * tri-state `Menu` + `MenuRadioGroup`, so "follow the system" became a
 * *selectable* option rather than merely the absence of a stored choice.
 * These stories were rewritten with it: the old `Light`/`Dark` stories
 * asserted an accessible name of "Switch to dark theme" and an
 * `aria-pressed` attribute, neither of which exists any more.
 *
 * Three preference states are worth showing, and they are not the same axis
 * as the two *rendered* palettes:
 *
 * - `Light` / `Dark` — an explicit stored choice. The trigger icon reflects
 *   the **resolved** theme, so it is the inverse-looking one (a moon offers
 *   "go dark" while light is showing).
 * - `System` — no stored choice; the radio group's checked item is
 *   `system`, which is the state the old two-state toggle could never
 *   express and the whole reason this ticket changed the control.
 *
 * Every story seeds `localStorage` explicitly rather than relying on
 * whatever a previous story left behind, because `ThemeToggle`'s state comes
 * from `useTheme()` (`getPersistedTheme()` + `prefers-color-scheme`), not
 * from `darkDecorator`'s document-level attribute. Pinning the tokens
 * without pinning the persisted choice they came from would show a dark
 * palette next to a control claiming "light" — a combination the real app
 * can never reach.
 *
 * No `tags: ['autodocs']` here, deliberately, for the same reason
 * `borders.stories.tsx`/`elevation.stories.tsx` omit it: `Dark` uses
 * `darkDecorator`, whose document-level mutation would turn the whole docs
 * page dark for as long as it is mounted — see that decorator's own file
 * comment for why, and why the toolbar-driven `theme` global carries the
 * identical restriction.
 */
const meta: Meta<typeof ThemeToggle> = {
  title: 'Components/ThemeToggle',
  component: ThemeToggle,
};

export default meta;
type Story = StoryObj<typeof ThemeToggle>;

/** Opens the menu and asserts which preference is checked. `MenuContent`
 * portals to `document.body`, outside `canvasElement` — same reasoning as
 * `locale-switcher.stories.tsx`'s own `Open` play function. */
async function expectCheckedPreference(canvasElement: HTMLElement, name: string) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Theme' }));

  const body = within(canvasElement.ownerDocument.body);
  const item = await body.findByRole('menuitemradio', { name });
  await expect(item).toHaveAttribute('aria-checked', 'true');
}

export const Light: Story = {
  loaders: [
    () => {
      // An explicit choice, not `removeItem` — removing the key is now the
      // `System` story's job, and would otherwise resolve through
      // `prefers-color-scheme` and render dark on any host whose OS
      // preference is dark.
      localStorage.setItem('biddaloy:theme', 'light');
      return {};
    },
  ],
  render: () => <ThemeToggle />,
  play: async ({ canvasElement }) => {
    await expectCheckedPreference(canvasElement, 'Light');
  },
};

export const Dark: Story = {
  // See `borders.stories.tsx`'s `RolesDark` for why this has to sit
  // alongside `darkDecorator`, not just belt-and-braces: without it the
  // toolbar-driven `theme` global's own effect would undo this decorator's
  // attribute write back to light the instant the toolbar is not itself
  // set to dark.
  parameters: darkDecoratorParameters,
  decorators: [darkDecorator],
  loaders: [
    () => {
      localStorage.setItem('biddaloy:theme', 'dark');
      return {};
    },
  ],
  render: () => <ThemeToggle />,
  play: async ({ canvasElement }) => {
    await expectCheckedPreference(canvasElement, 'Dark');
  },
};

/** The state [8.14.2] exists to make reachable: no stored choice, so the
 * palette tracks `prefers-color-scheme` live. Which of the two palettes
 * renders here depends on the host's OS setting — that is the point, and is
 * why this story asserts the checked *preference* rather than a palette. */
export const System: Story = {
  loaders: [
    () => {
      localStorage.removeItem('biddaloy:theme');
      return {};
    },
  ],
  render: () => <ThemeToggle />,
  play: async ({ canvasElement }) => {
    await expectCheckedPreference(canvasElement, 'System');
  },
};
