import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { PrintQueueView, type PrintQueueWidgetDto } from './print-queue.widget';

const data: PrintQueueWidgetDto = {
  total: 46,
  by_kind: [
    { kind: 'EXAM_ADMIT_CARD', count: 40 },
    { kind: 'STUDENT_ID_CARD', count: 6 },
  ],
};

const meta: Meta<typeof PrintQueueView> = {
  title: 'Dashboard/Widgets/PrintQueue',
  component: PrintQueueView,
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
type Story = StoryObj<typeof PrintQueueView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Zero: Story = { args: { data: { total: 0, by_kind: [] } } };
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
