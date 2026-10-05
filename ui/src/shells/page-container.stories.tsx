import type { Meta, StoryObj } from '@storybook/react-vite';

import { PageContainer } from './page-container';

const meta: Meta<typeof PageContainer> = {
  title: 'Shells/PageContainer',
  component: PageContainer,
  tags: ['autodocs'],
  render: (args) => (
    <PageContainer {...args}>
      <div className="rounded-lg border border-border-subtle bg-surface p-4">
        পৃষ্ঠার বিষয়বস্তু (Page content)
      </div>
    </PageContainer>
  ),
};

export default meta;
type Story = StoryObj<typeof PageContainer>;

export const Wide: Story = { args: { size: 'wide' } };
export const Narrow: Story = { args: { size: 'narrow' } };
