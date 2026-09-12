import type { Meta, StoryObj } from '@storybook/react-vite';

import { RestoreWorkbookDialog } from './restore-workbook-dialog';

/**
 * [14.13.3] School detail's "Restore from workbook" dialog — open/closed,
 * same "not wired into this repo's Storybook config yet" gap
 * `-create-school-wizard.stories.tsx` documents (only `ui/src/**` is
 * globbed today). Written anyway for when that gap is fixed.
 */
const meta: Meta<typeof RestoreWorkbookDialog> = {
  component: RestoreWorkbookDialog,
  args: {
    schoolId: '00000000-0000-4000-8000-000000000001',
    schoolName: 'Ananta School',
    onOpenChange: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof RestoreWorkbookDialog>;

export const Open: Story = {
  args: { open: true },
};

export const Closed: Story = {
  args: { open: false },
};
