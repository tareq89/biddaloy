import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { ResultsStateView, type ResultsStateDto } from './results-state.widget';

const data: ResultsStateDto = {
  draft: 1,
  processed: 1,
  published: 3,
  rounds: [
    {
      exam_name: 'Half Yearly',
      class_count: 3,
      draft: 1,
      processed: 1,
      published: 3,
      last_published_at: null,
    },
  ],
};

const meta: Meta<typeof ResultsStateView> = {
  title: 'Dashboard/Widgets/ResultsState',
  component: ResultsStateView,
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
type Story = StoryObj<typeof ResultsStateView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Empty: Story = {
  args: { data: { draft: 0, processed: 0, published: 0, rounds: [] } },
};
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
