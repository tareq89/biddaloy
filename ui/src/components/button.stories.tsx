import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Save changes' },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Save changes' });
    await userEvent.click(button);
    await expect(button).toBeEnabled();
  },
};

export const Loading: Story = {
  args: { loading: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** Stands in for this issue's "empty" state category — an icon-only button
 * has no visible label, the closest analog `Button` has to "empty". The
 * `aria-label` is required by the type; try removing it in this story's
 * args to see the compile error the wrapper's job is to produce. */
export const IconOnly: StoryObj<typeof Button> = {
  args: {
    iconOnly: true,
    'aria-label': 'Delete row',
    children: <span aria-hidden="true">×</span>,
  },
};

/** Stands in for this issue's "error" state category — `destructive` is
 * this design system's error/danger variant. */
export const Error: Story = {
  args: { variant: 'destructive', children: 'Delete student record' },
};

/** Neither of this package's two supported locales (`en`, `bn`) is RTL —
 * see `.storybook/locale.tsx` — so this forces `dir="rtl"` directly rather
 * than switching locale, to prove the component's own layout (icon/label
 * order, focus ring, spacing) holds up under a bidi flip regardless of
 * whether a real RTL locale exists yet. */
export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
