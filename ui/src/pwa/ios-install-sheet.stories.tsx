import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { IosInstallSheet } from './ios-install-sheet';

const meta: Meta<typeof IosInstallSheet> = {
  title: 'PWA/IosInstallSheet',
  component: IosInstallSheet,
  tags: ['autodocs'],
  args: {
    open: true,
    onOpenChange: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof IosInstallSheet>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(canvasElement.ownerDocument.body).getByRole('dialog');
    await expect(within(dialog).getByText('Install this app')).toBeInTheDocument();
  },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
