import type { Meta, StoryObj } from '@storybook/react-vite';

import { SocialButtons } from './social-buttons';

const meta: Meta<typeof SocialButtons> = {
  title: 'Components/SocialButtons',
  component: SocialButtons,
  tags: ['autodocs'],
  args: {
    providers: ['google', 'facebook'],
    labelFor: (p) => `Continue with ${p === 'google' ? 'Google' : 'Facebook'}`,
    hrefFor: (p) => `/api/v1/auth/social/${p}/start`,
  },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof SocialButtons>;

export const Both: Story = {};
export const GoogleOnly: Story = { args: { providers: ['google'] } };
/** Renders nothing: the screen shows no "or" divider either. */
export const NoProviders: Story = { args: { providers: [] } };
export const Disabled: Story = { args: { disabled: true } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
