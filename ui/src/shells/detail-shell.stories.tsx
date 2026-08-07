import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { DetailShell, type DetailShellTab } from './detail-shell';
import { useDetailShellTab } from './use-detail-shell-tab';

const meta: Meta<typeof DetailShell> = {
  title: 'Shells/DetailShell',
  tags: ['autodocs'],
  decorators: [
    (StoryFn) => (
      <MemoryRouter initialEntries={['/students/1']}>
        <StoryFn />
      </MemoryRouter>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DetailShell>;

const TAB_IDS = ['overview', 'payments', 'documents'] as const;

function StudentDetailPage({ readOnly = false }: { readOnly?: boolean }) {
  const [activeTab, setTab] = useDetailShellTab(TAB_IDS);

  const tabs: DetailShellTab[] = [
    { id: 'overview', label: 'Overview', content: <p>Enrolled in Class Six, Section A.</p> },
    { id: 'payments', label: 'Payments', content: <p>3 payments recorded this term.</p> },
    {
      id: 'documents',
      label: 'Documents',
      content: <p>Birth certificate, transfer certificate.</p>,
    },
  ];

  return (
    <DetailShell
      name="Rahim Uddin"
      identifiers={<span>ID: STU-1029 · Class Six, Section A</span>}
      statusBadge={
        <span className="rounded-full bg-status-paid-bg px-2 py-0.5 text-xs text-status-paid-fg">
          Active
        </span>
      }
      actions={[
        { id: 'record-payment', label: 'Record payment', onClick: () => {} },
        { id: 'edit', label: 'Edit', onClick: () => {}, variant: 'outline' },
        {
          id: 'delete',
          label: 'Delete',
          onClick: () => {},
          variant: 'destructive',
          allowed: !readOnly,
        },
      ]}
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setTab}
    />
  );
}

export const Default: Story = {
  render: () => <StudentDetailPage />,
};

/** A user without delete permission — the `allowed: false` action is
 * hidden entirely, not just disabled. */
export const PermissionGated: Story = {
  render: () => <StudentDetailPage readOnly />,
};

export const DeepLinkedTab: Story = {
  decorators: [
    (StoryFn) => (
      <MemoryRouter initialEntries={['/students/1?tab=payments']}>
        <StoryFn />
      </MemoryRouter>
    ),
  ],
  render: () => <StudentDetailPage />,
};

export const RightToLeft: Story = {
  render: () => (
    <DetailShell
      name="রহিম উদ্দিন"
      identifiers={<span>আইডি: STU-1029 · ষষ্ঠ শ্রেণি</span>}
      tabs={[
        { id: 'overview', label: 'সারসংক্ষেপ', content: <p>ষষ্ঠ শ্রেণিতে ভর্তি।</p> },
        {
          id: 'payments',
          label: 'পেমেন্ট',
          content: <p>এই মেয়াদে ৩টি পেমেন্ট রেকর্ড করা হয়েছে।</p>,
        },
      ]}
      activeTab="overview"
      onTabChange={() => {}}
    />
  ),
  decorators: [rtlDecorator],
};
