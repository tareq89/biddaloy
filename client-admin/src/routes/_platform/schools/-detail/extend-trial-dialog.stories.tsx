import type { Meta, StoryObj } from '@storybook/react-vite';

import { ExtendTrialDialog } from './extend-trial-dialog';

/**
 * [13.5] The extend-trial dialog, open. `useExtendTrial` fires a real request in
 * Storybook (no MSW here, same gap as `status-action-dialog.stories.tsx`);
 * harmless since nobody submits from a story.
 */
const meta: Meta<typeof ExtendTrialDialog> = {
  component: ExtendTrialDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    schoolId: '00000000-0000-4000-8000-000000000001',
    schoolName: 'Ananta School',
  },
};
export default meta;

type Story = StoryObj<typeof ExtendTrialDialog>;

export const Default: Story = {};

export const Phone: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
