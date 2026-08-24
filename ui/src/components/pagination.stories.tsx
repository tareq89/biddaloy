import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Pagination } from './pagination';

const meta: Meta<typeof Pagination> = {
  title: 'Components/Pagination',
  component: Pagination,
  tags: ['autodocs'],
  args: { page: 2, pageSize: 20, totalCount: 145, onPageChange: () => {} },
};

export default meta;
type Story = StoryObj<typeof Pagination>;

export const Default: Story = {};

export const FirstPage: Story = {
  args: { page: 1 },
};

export const LastPage: Story = {
  args: { page: 8 },
};

/** No results — stands in for this issue's "empty" state category. */
export const Empty: Story = {
  args: { page: 1, totalCount: 0 },
};

export const RightToLeft: Story = {
  args: { previousLabel: 'পূর্ববর্তী', nextLabel: 'পরবর্তী' },
  decorators: [rtlDecorator],
};
