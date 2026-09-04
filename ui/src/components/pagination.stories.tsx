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

/** [8.14.15] `globals: { locale: 'bn' }` — labels and the range's numerals
 * both come from `t()`/`formatNumber` now, no `previousLabel`/`nextLabel`
 * override needed (unlike the `RightToLeft` story above, written before
 * this ticket). */
export const Bangla: Story = {
  globals: { locale: 'bn' },
};

/** The `totalCount === 0` line uses a different i18next key
 * (`table.empty`) than the populated range — this covers it under `bn`. */
export const BanglaEmpty: Story = {
  args: { page: 1, totalCount: 0 },
  globals: { locale: 'bn' },
};
