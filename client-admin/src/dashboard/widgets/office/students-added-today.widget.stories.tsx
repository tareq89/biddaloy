import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { StudentsAddedTodayView, type StudentsAddedTodayDto } from './students-added-today.widget';

const data: StudentsAddedTodayDto = { added_today: 3, as_of: '2026-10-07' };

const meta: Meta<typeof StudentsAddedTodayView> = {
  title: 'Dashboard/Widgets/StudentsAddedToday',
  component: StudentsAddedTodayView,
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
type Story = StoryObj<typeof StudentsAddedTodayView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Zero: Story = { args: { data: { added_today: 0, as_of: '2026-10-07' } } };
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
