import type { Meta, StoryObj } from '@storybook/react-vite';

import { MonthHeader } from './month-header';

const meta: Meta<typeof MonthHeader> = {
  title: 'Components/MonthHeader',
  component: MonthHeader,
  tags: ['autodocs'],
  args: {
    label: 'September 2026',
    onPrevious: () => {},
    onNext: () => {},
    onToday: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof MonthHeader>;

export const Default: Story = {};
export const WithLabelPicker: Story = { args: { onLabelClick: () => {}, labelExpanded: false } };
export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
