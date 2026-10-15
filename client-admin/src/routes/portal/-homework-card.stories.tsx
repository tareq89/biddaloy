import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { HomeworkCardView } from './-homework-card';

const items = [
  {
    key: '1',
    childName: 'Fatima',
    subject: 'Math',
    title: 'Algebra exercise 3',
    dueDate: '2026-11-23',
  },
  {
    key: '2',
    childName: 'Imran',
    subject: 'Science',
    title: 'Plant diagram',
    dueDate: '2026-11-24',
  },
  {
    key: '3',
    childName: 'Fatima',
    subject: 'English',
    title: 'Essay: my school',
    dueDate: '2026-11-30',
  },
];

const meta: Meta<typeof HomeworkCardView> = {
  title: 'Portal/HomeworkCard',
  component: HomeworkCardView,
  decorators: [
    withMemoryRouter(['/portal']),
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  args: { variant: 'full', items, today: '2026-11-23' },
};
export default meta;
type Story = StoryObj<typeof HomeworkCardView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Compact: Story = {
  args: { variant: 'compact' },
  decorators: [
    (Story) => (
      <div className="w-[390px]">
        <Story />
      </div>
    ),
  ],
};
export const Empty: Story = { args: { items: [] } };
export const Loading: Story = { args: { items: [], loading: true } };
export const Error: Story = { args: { items: [], failed: true, onRetry: () => undefined } };
