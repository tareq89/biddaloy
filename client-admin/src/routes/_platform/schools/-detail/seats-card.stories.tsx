import type { Meta, StoryObj } from '@storybook/react-vite';

import { SeatsCard } from './seats-card';

/**
 * Epic 49 W4: the Seats card on the platform school page. It loads its own data, so Storybook
 * shows the loading state (no MSW here, same gap as `status-action-dialog.stories.tsx`); the
 * populated states live in `school-billing-view.stories.tsx`.
 */
const meta: Meta<typeof SeatsCard> = {
  component: SeatsCard,
  args: { schoolId: '00000000-0000-4000-8000-000000000001', schoolName: 'Ananta School' },
};
export default meta;

type Story = StoryObj<typeof SeatsCard>;

export const Default: Story = {};
