import type { Meta, StoryObj } from '@storybook/react-vite';

import { ReviveDialog } from './revive-dialog';

/** Epic 49 W4. Opens the dialog; nobody submits from a story, so no request is made. */
const meta: Meta<typeof ReviveDialog> = {
  component: ReviveDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    schoolId: '00000000-0000-4000-8000-000000000001',
    schoolName: 'Ananta School',
  },
};
export default meta;

type Story = StoryObj<typeof ReviveDialog>;

export const Default: Story = {};

export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
