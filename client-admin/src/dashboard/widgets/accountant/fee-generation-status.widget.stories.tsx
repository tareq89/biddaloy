import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import {
  FeeGenerationStatusView,
  type FeeGenerationStatusDto,
} from './fee-generation-status.widget';

const data: FeeGenerationStatusDto = {
  period: '2026-10',
  generated: true,
  first_generated_at: '2026-10-01T00:00:12.000Z',
  bill_count: 412,
  batch_count: 1,
  next_scheduled_run: '2026-11-01',
};

const meta: Meta<typeof FeeGenerationStatusView> = {
  title: 'Dashboard/Widgets/FeeGenerationStatus',
  component: FeeGenerationStatusView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof FeeGenerationStatusView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
/** "Empty" for this widget is the not-generated state: warning badge + one primary. */
export const Empty: Story = {
  args: {
    data: {
      ...data,
      generated: false,
      first_generated_at: null,
      bill_count: 0,
      batch_count: 0,
      next_scheduled_run: null,
    },
  },
};
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
