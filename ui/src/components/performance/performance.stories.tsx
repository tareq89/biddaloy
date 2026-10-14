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

const syllabus = [
  { label: 'Class 6', value: 41, valueLabel: '41%', highlight: true, note: '19% behind' },
  { label: 'Class 7', value: 63, valueLabel: '63%' },
  { label: 'Class 8', value: 72, valueLabel: '72%' },
];
const target = { value: 60, label: 'Expected by today: 60%' };

export const WithTargetAndHighlight: Story = {
  render: () => (
    <BarWidget
      title="Syllabus progress"
      bars={syllabus}
      target={target}
      emphasis="highlighted"
      emptyLabel="Not enough data yet"
    />
  ),
};

export const LowestEmphasised: Story = {
  render: () => (
    <BarWidget
      title="Mark entry"
      bars={[
        { label: 'Class 6', value: 88, valueLabel: '88%' },
        { label: 'Class 7', value: 35, valueLabel: '35%', highlight: true },
        { label: 'Class 8', value: 76, valueLabel: '76%' },
      ]}
      emphasis="highlighted"
      emptyLabel="Not enough data yet"
    />
  ),
};

export const BareInsideCard: Story = {
  render: () => (
    <div className="rounded-lg border border-border-subtle p-4">
      <BarWidget bare bars={syllabus} target={target} emptyLabel="Not enough data yet" />
    </div>
  ),
};

export const TargetDark: Story = {
  ...WithTargetAndHighlight,
  globals: { theme: 'dark' },
};

export const Phone: Story = {
  render: () => <Overview />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
