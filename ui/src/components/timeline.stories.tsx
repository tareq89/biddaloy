import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Timeline, type TimelineItem } from './timeline';

const meta: Meta<typeof Timeline> = {
  title: 'Components/Timeline',
  component: Timeline,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Timeline>;

const ITEMS: TimelineItem[] = [
  {
    id: '1',
    title: 'Rahim Uddin submitted',
    time: '2026-03-01T09:30:00Z',
    badge: 'Submitted',
    tone: 'info',
  },
  {
    id: '2',
    title: 'Step approved by Karim Ahmed',
    time: '2026-03-02T10:00:00Z',
    badge: 'Approved',
    tone: 'success',
  },
  {
    id: '3',
    title: 'Comment from Nasrin Akter',
    time: '2026-03-02T14:15:00Z',
    body: 'Please attach the receipt.',
  },
  {
    id: '4',
    title: 'Application approved',
    time: '2026-03-03T08:00:00Z',
    badge: 'Approved',
    tone: 'success',
  },
];

export const Default: Story = {
  args: { 'aria-label': 'History', items: ITEMS },
};

export const Empty: Story = {
  args: { 'aria-label': 'History', items: [], emptyText: 'No history yet' },
};

export const LongBody: Story = {
  args: {
    'aria-label': 'History',
    items: [
      {
        id: '1',
        title: 'Comment from Nasrin Akter',
        time: '2026-03-02T14:15:00Z',
        body: 'This request covers three separate days of leave across two terms, so it needs the class teacher and the head teacher to both agree before it is recorded. '.repeat(
          3,
        ),
      },
    ],
  },
};

export const Bangla: Story = {
  args: {
    'aria-label': 'ইতিহাস',
    items: [
      {
        id: '1',
        title: 'রহিম উদ্দিন জমা দিয়েছেন',
        time: '2026-03-01T09:30:00Z',
        badge: 'জমা',
        tone: 'info',
      },
      {
        id: '2',
        title: 'মন্তব্য',
        time: '2026-03-02T14:15:00Z',
        body: 'অনুগ্রহ করে রসিদ সংযুক্ত করুন।',
      },
    ],
  },
  decorators: [rtlDecorator],
};
