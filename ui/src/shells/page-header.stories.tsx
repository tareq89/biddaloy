import type { Meta, StoryObj } from '@storybook/react-vite';
import { PlusIcon } from 'lucide-react';

import { PageHeader, type PageAction } from './page-header';

const meta: Meta<typeof PageHeader> = {
  title: 'Shells/PageHeader',
  component: PageHeader,
  tags: ['autodocs'],
  args: { title: 'শিক্ষার্থী তালিকা' },
};

export default meta;
type Story = StoryObj<typeof PageHeader>;

const noop = () => {};
const ACTIONS: PageAction[] = [
  { id: 'add', label: 'নতুন শিক্ষার্থী', onClick: noop, priority: 'primary', icon: <PlusIcon /> },
  { id: 'import', label: 'Import', onClick: noop },
  { id: 'export', label: 'Export', onClick: noop },
  { id: 'print', label: 'Print list', onClick: noop, priority: 'tertiary' },
  { id: 'archive', label: 'Archive all', onClick: noop, priority: 'destructive' },
];

export const TitleOnly: Story = {};
export const WithSubtitle: Story = { args: { subtitle: '২৪০ জন শিক্ষার্থী · 2026' } };
export const WithActions: Story = { args: { subtitle: '২৪০ জন শিক্ষার্থী', actions: ACTIONS } };
export const WithActionsMobile: Story = {
  args: { subtitle: '২৪০ জন শিক্ষার্থী', actions: ACTIONS },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
