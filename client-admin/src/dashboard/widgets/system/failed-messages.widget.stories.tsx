import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { FailedMessagesView, type FailedMessagesDto } from './failed-messages.widget';

const data: FailedMessagesDto = {
  failed: 3,
  window: { from: '2026-10-01', to: '2026-10-07' },
};

const meta: Meta<typeof FailedMessagesView> = {
  title: 'Dashboard/Widgets/FailedMessages',
  component: FailedMessagesView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-xs">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof FailedMessagesView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const NoneFailed: Story = { args: { data: { ...data, failed: 0 } } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
