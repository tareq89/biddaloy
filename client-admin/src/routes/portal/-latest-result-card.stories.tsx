import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../ui/.storybook/router-decorator';

import { LatestResultCardView } from './-latest-result-card';

const meta: Meta<typeof LatestResultCardView> = {
  title: 'Portal/LatestResultCard',
  component: LatestResultCardView,
  decorators: [
    withMemoryRouter(['/portal']),
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
  args: {
    variant: 'full',
    childId: 'kid-a',
    childName: 'Fatima',
    result: { examName: 'Half-yearly', gpa: 4.67, isFail: false, previousGpa: 4.5 },
  },
};
export default meta;
type Story = StoryObj<typeof LatestResultCardView>;

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
export const Failed: Story = {
  args: { result: { examName: 'Half-yearly', gpa: 2.1, isFail: true, previousGpa: 4.5 } },
};
export const Empty: Story = { args: { result: null } };
export const Loading: Story = { args: { result: null, loading: true } };
export const Error: Story = { args: { result: null, failed: true, onRetry: () => undefined } };
