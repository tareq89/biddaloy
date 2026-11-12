import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ArchiveSchoolDialog } from './archive-school-dialog';
import { ExtendTrialDialog } from './extend-trial-dialog';
import { RenameSchoolDialog } from './rename-school-dialog';
import { StuckAdminDialog } from './stuck-admin-dialog';

/** #3821 School 360 controls at phone width (390 px). Data comes from the default cockpit mock handlers. */
const noop = () => undefined;

const meta: Meta = {
  title: 'Cockpit/School controls',
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  decorators: [
    (Story) => (
      <ApprovalModalHostProvider>
        <Story />
      </ApprovalModalHostProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj;

export const ExtendTrial: Story = {
  render: () => (
    <ExtendTrialDialog open onOpenChange={noop} schoolId="s-1" schoolName="Rose Valley School" />
  ),
};
export const Rename: Story = {
  render: () => (
    <RenameSchoolDialog open onOpenChange={noop} schoolId="s-1" currentName="Rose Valley School" />
  ),
};
export const Archive: Story = {
  render: () => (
    <ArchiveSchoolDialog open onOpenChange={noop} schoolId="s-1" schoolName="Rose Valley School" />
  ),
};
export const StuckAdmin: Story = {
  render: () => (
    <StuckAdminDialog open onOpenChange={noop} schoolId="s-1" schoolName="Rose Valley School" />
  ),
};
