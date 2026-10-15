import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { DuesByClassView, type DuesByClassDto } from './dues-by-class.widget';

const data: DuesByClassDto = {
  total_due: 386000,
  classes: [120000, 90000, 70000, 50000, 30000, 20000, 6000].map((amount, i) => ({
    class_id: `00000000-0000-4000-8000-00000000000${i}`,
    class_name: `Class ${10 - i}`,
    amount,
    student_count: 20 - i,
  })),
};

const meta: Meta<typeof DuesByClassView> = {
  title: 'Dashboard/Widgets/DuesByClass',
  component: DuesByClassView,
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
type Story = StoryObj<typeof DuesByClassView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = { args: { data: { total_due: 0, classes: [] } } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
