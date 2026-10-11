import type { Meta, StoryObj } from '@storybook/react-vite';

import { RestoreInProgressNotice } from './restore-in-progress-bar';

const meta: Meta<typeof RestoreInProgressNotice> = { component: RestoreInProgressNotice };
export default meta;
type Story = StoryObj<typeof RestoreInProgressNotice>;

/** Shown in the staff shell after a save is refused with 423 TENANT_RESTORING. */
export const Visible: Story = {};
