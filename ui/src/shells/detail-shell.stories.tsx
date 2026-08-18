import type { Meta, StoryObj } from '@storybook/react';
import { expect, userEvent, within } from '@storybook/test';
import * as React from 'react';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { DetailShell, type DetailShellTab } from './detail-shell';
import { useDetailShellTab } from './use-detail-shell-tab';

// No router decorator at the `meta` level — a story that needs its own
// `initialEntries` (`DeepLinkedTab`) needs its own router, not a shared
// one. Each story that renders `useDetailShellTab` supplies its own via
// `withMemoryRouter` instead; `RightToLeft` doesn't call that hook at
// all, so it needs no router.
const meta: Meta<typeof DetailShell> = {
  title: 'Shells/DetailShell',
  tags: ['autodocs'],
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

/** Local state (typed here, not passed in as a prop) — the strongest
 * proof that a panel actually stays mounted, rather than just looking
 * unchanged because its content happens to be static. */
function PaymentNotePanel() {
  const [note, setNote] = React.useState('');
  return (
    <div className="flex flex-col gap-2">
      <p>3 payments recorded this term.</p>
      <label className="flex flex-col gap-1 text-sm">
        Follow-up note
        <input
          className="rounded border border-border px-2 py-1"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
    </div>
  );
}

function StudentDetailPageWithCachedPanel() {
  const [activeTab, setTab] = useDetailShellTab(TAB_IDS);

  const tabs: DetailShellTab[] = [
    { id: 'overview', label: 'Overview', content: <p>Enrolled in Class Six, Section A.</p> },
    { id: 'payments', label: 'Payments', content: <PaymentNotePanel /> },
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
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setTab}
    />
  );
}

const withStudentOneRouter = [withMemoryRouter(['/students/1'])];

export const Default: Story = {
  decorators: withStudentOneRouter,
  render: () => <StudentDetailPage />,
};

/** Demonstrates the shell's actual selling point — lazy-mount, then stay
 * cached: types into the Payments panel's own local state, switches to
 * Overview and back, and asserts the note is still there. A panel that
 * had been unmounted (Radix's default) would have reset that state to
 * empty on remount. */
export const CachedTabState: Story = {
  decorators: withStudentOneRouter,
  render: () => <StudentDetailPageWithCachedPanel />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole('tab', { name: 'Payments' }));
    const note = canvas.getByLabelText('Follow-up note');
    await userEvent.type(note, 'called about overdue fee');

    await userEvent.click(canvas.getByRole('tab', { name: 'Overview' }));
    await userEvent.click(canvas.getByRole('tab', { name: 'Payments' }));

    await expect(canvas.getByLabelText('Follow-up note')).toHaveValue('called about overdue fee');
  },
};

/** A user without delete permission — the `allowed: false` action is
 * hidden entirely, not just disabled. */
export const PermissionGated: Story = {
  decorators: withStudentOneRouter,
  render: () => <StudentDetailPage readOnly />,
};

export const DeepLinkedTab: Story = {
  decorators: [withMemoryRouter(['/students/1?tab=payments'])],
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
