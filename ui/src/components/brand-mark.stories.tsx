import type { Meta, StoryObj } from '@storybook/react-vite';

import { Monogram, Wordmark } from './brand-mark';

const meta: Meta<typeof Wordmark> = {
  title: 'Components/BrandMark',
  component: Wordmark,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Wordmark>;

export const WordmarkAuto: Story = {};
export const WordmarkLight: Story = { args: { variant: 'light' } };
export const WordmarkDark: Story = {
  args: { variant: 'dark' },
  decorators: [
    (Story) => (
      <div className="p-4" style={{ background: '#191919' }}>
        <Story />
      </div>
    ),
  ],
};
export const WordmarkMono: Story = { args: { variant: 'mono' } };
export const MonogramLight: Story = { render: () => <Monogram /> };
export const MonogramDark: Story = {
  render: () => (
    <div className="p-4" style={{ background: '#191919' }}>
      <Monogram variant="dark" />
    </div>
  ),
};
