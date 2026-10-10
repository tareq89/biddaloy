import type { Meta, StoryObj } from '@storybook/react-vite';

import { TrialDetailsDialog } from './trial-details-dialog';

/** [13.5.1] Trial details dialog; opens from `/dashboard?trial=1` [67.2.04]. Toolbar locale switches to Bangla. */
const meta: Meta<typeof TrialDetailsDialog> = {
  title: 'Features/Onboarding/TrialDetailsDialog',
  component: TrialDetailsDialog,
};
export default meta;

export const Details: StoryObj<typeof TrialDetailsDialog> = {
  render: () => (
    <TrialDetailsDialog
      open
      onOpenChange={() => undefined}
      daysLeft={12}
      seats={{ used: 12, limit: 50 }}
      supportUrl="https://example.com/contact"
    />
  ),
};
