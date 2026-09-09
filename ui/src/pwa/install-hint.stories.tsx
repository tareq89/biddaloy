import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { InstallHint } from './install-hint';

const meta: Meta<typeof InstallHint> = {
  title: 'PWA/InstallHint',
  component: InstallHint,
  tags: ['autodocs'],
  args: {
    onInstall: fn(),
    onDismiss: fn(),
  },
};

export default meta;
type Story = StoryObj<typeof InstallHint>;

export const Default: Story = {};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
