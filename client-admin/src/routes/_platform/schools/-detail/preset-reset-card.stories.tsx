import type { Meta, StoryObj } from '@storybook/react-vite';

import { ResetPresetCard } from './preset-reset-card';
import { PresetResetDialog } from './preset-reset-dialog';

/**
 * [35.4.4] Card (closed) and the dialog open. Blocked / not-applied / success
 * states need a server response, so they are covered by the component tests;
 * same "no MSW in Storybook" gap the sibling -detail stories note.
 */
const meta: Meta<typeof ResetPresetCard> = {
  component: ResetPresetCard,
  args: { schoolId: '00000000-0000-4000-8000-000000000001', schoolName: 'Ananta School' },
};
export default meta;

type Story = StoryObj<typeof ResetPresetCard>;

export const Card: Story = {};

export const DialogOpen: Story = {
  render: (args) => <PresetResetDialog open onOpenChange={() => {}} {...args} />,
};
