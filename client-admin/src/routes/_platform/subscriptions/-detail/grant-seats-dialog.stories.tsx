import type { Meta, StoryObj } from '@storybook/react-vite';

import { GrantSeatsDialog } from './grant-seats-dialog';

/** Epic 49 W4. Opens the dialog; nobody submits from a story, so no request is made. */
const meta: Meta<typeof GrantSeatsDialog> = {
  component: GrantSeatsDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    schoolId: '00000000-0000-4000-8000-000000000001',
    schoolName: 'Ananta School',
  },
};
export default meta;

type Story = StoryObj<typeof GrantSeatsDialog>;

export const Default: Story = {};

export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
