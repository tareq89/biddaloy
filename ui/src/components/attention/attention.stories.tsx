/**
 * [67.2.02] Attention components. The file is titled after the modal; the
 * bar, card, snooze menu and student strip are shown through `render`.
 * Bangla stories use the toolbar-less `globals: { locale: 'bn' }` switch.
 */
import { AlertSeverity } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import {
  alertItemFactory,
  attentionSummaryFactory,
  studentAlertFactory,
} from '../../test/factories/attention.factory';

import { AlertItemCard } from './alert-item-card';
import { AlertSnoozeMenu } from './alert-snooze-menu';
import { AttentionBar } from './attention-bar';
import { AttentionModal, type AttentionModalProps } from './attention-modal';
import { StudentAlertStrip } from './student-alert-strip';

const meta: Meta<typeof AttentionModal> = {
  title: 'Attention/AttentionModal',
  component: AttentionModal,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AttentionModal>;

const noop = () => {};
const item = (id: string, severity: AlertSeverity, title: string, closable = true) =>
  alertItemFactory({ recipientId: id, severity, title, closable });

const ITEMS = [
  item('c1', AlertSeverity.CRITICAL, 'ফি সংগ্রহ বন্ধ: এসএমএস ক্রেডিট শেষ', false),
  item('c2', AlertSeverity.CRITICAL, 'সর্বশেষ ব্যাকআপ ব্যর্থ হয়েছে', false),
  item('w1', AlertSeverity.WARNING, '৭ম-খ শাখার উপস্থিতি নেওয়া হয়নি'),
  item('r1', AlertSeverity.REMINDER, 'কাল বাড়ির কাজ জমার দিন'),
  item('r2', AlertSeverity.REMINDER, 'নম্বর দেওয়ার বাকি বাড়ির কাজ আছে'),
];
const SUMMARY = attentionSummaryFactory({
  critical: 2,
  warning: 1,
  reminder: 2,
  activeTotal: 5,
  top: ITEMS[0]!,
});

function Modal(props: Partial<AttentionModalProps>) {
  const [open, setOpen] = React.useState(true);
  return (
    <AttentionModal
      open={open}
      onOpenChange={setOpen}
      items={ITEMS}
      summary={SUMMARY}
      onRetry={noop}
      onPrimary={noop}
      onHide={noop}
      onSnooze={noop}
      todoHref="/notifications"
      todoCount={5}
      {...props}
    />
  );
}

/** Two urgent, one warning, two reminders, in Bangla. */
export const Default: Story = { render: () => <Modal />, globals: { locale: 'bn' } };

export const English: Story = {
  render: () => (
    <Modal
      items={[
        item('c1', AlertSeverity.CRITICAL, 'Fee collection blocked: SMS credit is empty', false),
        item('w1', AlertSeverity.WARNING, 'Attendance not taken for 7B'),
        item('r1', AlertSeverity.REMINDER, 'Homework due tomorrow'),
      ]}
    />
  ),
  globals: { locale: 'en' },
};

export const Phone: Story = {
  render: () => <Modal />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  globals: { locale: 'bn' },
};

export const Loading: Story = { render: () => <Modal loading items={[]} /> };
export const ErrorState: Story = { render: () => <Modal error items={[]} /> };
export const Empty: Story = { render: () => <Modal items={[]} /> };
export const Stale: Story = {
  render: () => <Modal summary={attentionSummaryFactory({ ...SUMMARY, staleMinutes: 42 })} />,
};

export const BarCritical: Story = {
  render: () => <AttentionBar summary={SUMMARY} onOpen={noop} />,
  globals: { locale: 'bn' },
};

export const BarWarning: Story = {
  render: () => (
    <AttentionBar
      summary={attentionSummaryFactory({ warning: 3, reminder: 1, top: ITEMS[2]! })}
      onOpen={noop}
    />
  ),
};

export const BarReminder: Story = {
  render: () => (
    <AttentionBar
      summary={attentionSummaryFactory({ reminder: 2, top: ITEMS[3]! })}
      onOpen={noop}
    />
  ),
};

export const BarPhone: Story = {
  render: () => <AttentionBar summary={SUMMARY} onOpen={noop} />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  globals: { locale: 'bn' },
};

export const CardClosable: Story = {
  render: () => (
    <ul className="max-w-xl">
      <AlertItemCard
        item={ITEMS[2]!}
        emphasis="primary"
        onPrimary={noop}
        onHide={noop}
        onSnooze={noop}
      />
    </ul>
  ),
};

export const CardLocked: Story = {
  render: () => (
    <ul className="max-w-xl">
      <AlertItemCard item={ITEMS[0]!} emphasis="primary" onPrimary={noop} onHide={noop} />
    </ul>
  ),
};

export const SnoozeMenu: Story = {
  render: () => (
    <div className="flex justify-end p-6">
      <AlertSnoozeMenu onSelect={noop} />
    </div>
  ),
};

export const StripOneAlert: Story = {
  render: () => (
    <StudentAlertStrip
      studentName="রাফি আহমেদ"
      alerts={[studentAlertFactory({ seenCount: 3, recipientCount: 4 })]}
    />
  ),
  globals: { locale: 'bn' },
};

export const StripThreeAlerts: Story = {
  render: () => (
    <StudentAlertStrip
      studentName="রাফি আহমেদ"
      alerts={[
        studentAlertFactory({ severity: 'CRITICAL', title: 'ফি বকেয়া ৩ মাস' }),
        studentAlertFactory({ title: 'টানা ৩ দিন অনুপস্থিত', seenCount: 1, recipientCount: 2 }),
        studentAlertFactory({ severity: 'REMINDER', title: 'অভিভাবকের মোবাইল নম্বর নেই' }),
      ]}
    />
  ),
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  globals: { locale: 'bn' },
};
