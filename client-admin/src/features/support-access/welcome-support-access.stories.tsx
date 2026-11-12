import { AuthLayout } from '@biddaloy/ui/components';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { SupportWelcomeForm } from '../../routes/welcome.support-access';

/**
 * [99.G4.03] The one-step first-login card. Same "client-admin isn't globbed into a
 * running Storybook yet" gap as `application-forms.stories.tsx`.
 */
const meta = {
  title: 'Client admin/Support access/Welcome',
  component: SupportWelcomeForm,
  decorators: [
    (Story) => (
      <AuthLayout>
        <Story />
      </AuthLayout>
    ),
  ],
  args: { onSave: () => undefined },
} satisfies Meta<typeof SupportWelcomeForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** 390 px: full-width 44 px button. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const Saving: Story = { args: { saving: true } };

export const SaveFailed: Story = { args: { failed: true } };
