import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { LocaleSwitcher } from './locale-switcher';

/**
 * No loading/error/disabled state applies here — this isn't a
 * form control or a data-fetching component, just a trigger over a fixed,
 * locally-known list of locales. Default (closed) and Open cover the
 * component's real states; RTL proves the trigger and menu content both
 * survive a bidi flip (the menu itself renders in a Radix content portal,
 * outside this story's own `dir="rtl"` wrapper — see `rtl-decorator.tsx`'s
 * own comment on why it also sets `document.documentElement.dir`).
 */
const meta: Meta<typeof LocaleSwitcher> = {
  title: 'Components/LocaleSwitcher',
  component: LocaleSwitcher,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LocaleSwitcher>;

export const Default: Story = {
  render: () => <LocaleSwitcher />,
};

export const Open: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Change language' }));
    // Menu content portals to document.body, outside canvasElement — same
    // reasoning as dialog.stories.tsx's own play functions.
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.findByRole('menuitemradio', { name: 'English' })).resolves.toBeTruthy();
  },
  render: () => <LocaleSwitcher />,
};

export const Rtl: Story = {
  decorators: [rtlDecorator],
  render: () => <LocaleSwitcher align="start" />,
};
