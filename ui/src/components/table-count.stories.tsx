import type { Meta, StoryObj } from '@storybook/react-vite';

import { REGION_BD_BN, RegionConfigProvider } from '../i18n';

import { TableCount } from './table-count';

const meta: Meta<typeof TableCount> = {
  title: 'Components/TableCount',
  component: TableCount,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof TableCount>;

export const PaginatedRange: Story = { args: { total: 240, from: 26, to: 50 } };
export const UnpaginatedTotal: Story = { args: { total: 12 } };
export const BanglaDigits: Story = {
  args: { total: 240, from: 26, to: 50 },
  render: (args) => (
    <RegionConfigProvider value={REGION_BD_BN}>
      <TableCount {...args} />
    </RegionConfigProvider>
  ),
};
