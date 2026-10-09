import type { Meta, StoryObj } from '@storybook/react-vite';

import { ConfirmDialog } from './confirm-dialog';

const meta: Meta<typeof ConfirmDialog> = {
  title: 'Components/ConfirmDialog',
  component: ConfirmDialog,
  tags: ['autodocs'],
  args: {
    open: true,
    onOpenChange: () => {},
    onConfirm: () => {},
    title: 'শিক্ষার্থী মুছে ফেলবেন?',
    description: 'This cannot be undone.',
    confirmLabel: 'Delete',
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmDialog>;

export const Danger: Story = { args: { tone: 'danger' } };
export const Default: Story = {
  args: { tone: 'default', title: 'Publish results?', confirmLabel: 'Publish' },
};
export const Busy: Story = { args: { busy: true } };
