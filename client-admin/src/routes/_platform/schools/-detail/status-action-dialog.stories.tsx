import type { Meta, StoryObj } from '@storybook/react-vite';

import { StatusActionDialog } from './status-action-dialog';

/**
 * #535's confirm dialog — the Suspend flow (ACTIVE school) and the
 * Reactivate flow (SUSPENDED school), the two states the issue's
 * acceptance criteria call out by name. `useUpdateSchoolStatus` fires a
 * real request in Storybook (no MSW wiring in this repo yet, same gap
 * #533/#534's stories note); harmless here since nobody submits the form
 * from a story.
 */
const meta: Meta<typeof StatusActionDialog> = {
  component: StatusActionDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    schoolId: '00000000-0000-4000-8000-000000000001',
    schoolName: 'Ananta School',
  },
};
export default meta;

type Story = StoryObj<typeof StatusActionDialog>;

export const SuspendActiveSchool: Story = {
  args: {
    targetStatus: 'SUSPENDED',
  },
};

export const ReactivateSuspendedSchool: Story = {
  args: {
    targetStatus: 'ACTIVE',
  },
};
