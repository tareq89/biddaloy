import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { ThemeToggle } from './theme-toggle';

/**
 * Two rendered states — `aria-pressed="false"` (light, showing a moon:
 * "switch to dark") and `aria-pressed="true"` (dark, showing a sun: "switch
 * to light"). No loading/error/disabled state applies here — this is a
 * stateless flip, not a form control or a data-fetching component.
 *
 * Both stories seed `localStorage` explicitly (rather than relying on
 * whatever a previous story left behind) before mount: `ThemeToggle`'s own
 * resolved state comes from `useTheme()` (`getPersistedTheme()` +
 * `prefers-color-scheme`), not from `darkDecorator`'s document-level
 * attribute. Pinning only the tokens without pinning the persisted choice
 * they came from would show a "pressed" dark palette next to an
 * "unpressed" (light) toggle — a combination the real app can never
 * actually reach.
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

export const Light: Story = {
  loaders: [
    () => {
      // An explicit choice, not `removeItem` — removing the key would
      // resolve through `prefers-color-scheme` instead, which renders dark
      // (and fails this story's own `aria-pressed="false"` assertion) on
      // any host whose OS preference is dark.
      localStorage.setItem('biddaloy:theme', 'light');
      return {};
    },
  ],
  render: () => <ThemeToggle />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = await canvas.findByRole('button', { name: 'Switch to dark theme' });
    await expect(button).toHaveAttribute('aria-pressed', 'false');
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
    const canvas = within(canvasElement);
    const button = await canvas.findByRole('button', { name: 'Switch to light theme' });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
  },
};
