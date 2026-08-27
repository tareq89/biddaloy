/**
 * No loading/empty/error variants — `StudentPicker` holds no data of its
 * own; it renders the list its caller already has. The one state a story
 * cannot show is the most important one: fewer than two students renders
 * nothing at all, so a guardian of exactly one child sees no switching
 * UI. That is pinned in `student-picker.test.tsx` rather than shown as an
 * empty canvas here.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { StudentPicker } from './student-picker';

const items = [
  { id: 'student-1', name: 'Fatima Rahman', meta: 'Class 8 B · Roll 14' },
  { id: 'student-2', name: 'Imran Rahman', meta: 'Class 3 A · Roll 7' },
  { id: 'student-3', name: 'Ayesha Rahman', meta: 'Class 5 C · Roll 2' },
];

const meta: Meta<typeof StudentPicker> = {
  title: 'Components/StudentPicker',
  component: StudentPicker,
  tags: ['autodocs'],
  args: {
    label: 'Choose a student',
    items,
    selectedId: 'student-1',
    to: '/portal/fees',
  },
  decorators: [withMemoryRouter(['/portal/fees'])],
};

export default meta;
type Story = StoryObj<typeof StudentPicker>;

/** The first child is current — `aria-current="page"` plus the primary
 * border and tint, so the active child is never carried by colour alone. */
export const Default: Story = {};

export const SecondSelected: Story = {
  args: { selectedId: 'student-2' },
};

/** Six children: the row scrolls horizontally rather than shrinking the
 * chips below the 44px touch target. */
export const ManyChildren: Story = {
  args: {
    items: [
      ...items,
      { id: 'student-4', name: 'Nusrat Rahman', meta: 'Class 2 A · Roll 19' },
      { id: 'student-5', name: 'Tanvir Rahman', meta: 'Class 9 B · Roll 5' },
      { id: 'student-6', name: 'Sadia Rahman', meta: 'Class 6 C · Roll 31' },
    ],
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** Long Bangla names at 320px — chips keep their full name on one line
 * and scroll, rather than wrapping into an unreadable column. */
export const LongNames: Story = {
  args: {
    items: [
      {
        id: 'student-1',
        name: 'মোছাম্মৎ ফাতেমা তুজ জোহরা রহমান',
        meta: 'অষ্টম শ্রেণি খ · রোল ১৪',
      },
      {
        id: 'student-2',
        name: 'মোহাম্মদ ইমরান হোসেন রহমান',
        meta: 'তৃতীয় শ্রেণি ক · রোল ৭',
      },
    ],
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};
