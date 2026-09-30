import type { Meta, StoryObj } from '@storybook/react-vite';

import { BarWidget } from './bar-widget';
import { SummaryCard } from './summary-card';
import { SwipeRow } from './swipe-row';

const meta: Meta = {
  title: 'Components/Performance',
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj;

const bars = [
  { label: 'Mathematics', value: 82, valueLabel: '82%' },
  { label: 'English', value: 67, valueLabel: '67%' },
  { label: 'Science', value: 91, valueLabel: '91%' },
];
const headline = { label: 'Average score', value: '80%' };
const figures = [
  { label: 'Exams', value: '4' },
  { label: 'Best', value: '91%' },
  { label: 'Lowest', value: '67%' },
];

function Overview() {
  return (
    <div className="flex flex-col gap-3">
      <SummaryCard title="Performance" headline={headline} figures={figures} />
      <SwipeRow label="Performance widgets">
        <BarWidget title="By subject" bars={bars} emptyLabel="Not enough data yet" />
        <BarWidget title="By term" bars={bars.slice(0, 2)} emptyLabel="Not enough data yet" />
        <BarWidget title="Attendance" bars={[]} emptyLabel="Not enough data yet" />
      </SwipeRow>
    </div>
  );
}

export const Populated: Story = { render: () => <Overview /> };

export const Empty: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <SummaryCard title="Performance" headline={null} emptyLabel="Not enough data yet" />
      <SwipeRow label="Performance widgets">
        <BarWidget title="By subject" bars={[]} emptyLabel="Not enough data yet" />
      </SwipeRow>
    </div>
  ),
};

export const Loading: Story = {
  render: () => (
    <div className="flex flex-col gap-3">
      <SummaryCard title="Performance" headline={null} loading loadingLabel="Loading" />
      <SwipeRow label="Performance widgets">
        <BarWidget title="By subject" bars={[]} emptyLabel="" loading loadingLabel="Loading" />
      </SwipeRow>
    </div>
  ),
};

export const ErrorState: Story = {
  render: () => (
    <SwipeRow label="Performance widgets">
      <BarWidget title="By subject" bars={[]} emptyLabel="" error="Could not load this widget" />
    </SwipeRow>
  ),
};

export const Phone: Story = {
  render: () => <Overview />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
