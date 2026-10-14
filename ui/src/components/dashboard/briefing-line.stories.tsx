import type { Meta, StoryObj } from '@storybook/react-vite';
import { BanknoteIcon, SunIcon } from 'lucide-react';
import { expect, userEvent, within } from 'storybook/test';

import { darkDecorator, darkDecoratorParameters } from '../../../.storybook/dark-decorator';
import { Button } from '../button';

import { BriefingChip, BriefingLine } from './briefing-line';

const meta: Meta<typeof BriefingLine> = {
  title: 'Dashboard/BriefingLine',
  component: BriefingLine,
  tags: ['autodocs'],
};
export default meta;
type Story = StoryObj<typeof BriefingLine>;

const chips = (
  <>
    <BriefingChip>২টা ফি বাকি</BriefingChip>
    <BriefingChip>১টা ছুটির আবেদন</BriefingChip>
    <BriefingChip>১টা নোটিশ অপেক্ষমাণ</BriefingChip>
  </>
);

export const Headmaster: Story = {
  args: {
    icon: <SunIcon className="size-5" />,
    headline: 'সুপ্রভাত! আজ ৪টা বিষয় আপনার নজর চাইছে',
    mostUrgent: 'সবচেয়ে জরুরি: ৩টা শাখায় এখনো উপস্থিতি নেওয়া হয়নি (৭ম খ, ৯ম ক, ১০ম গ)।',
    action: <Button>উপস্থিতি দেখুন</Button>,
    items: chips,
    itemsLabel: 'বাকি ৩টা:',
    moreLabel: 'আরও ৩টা বিষয়',
  },
};

export const TeacherOneLiner: Story = {
  args: {
    headline: 'আজ আপনার ৫টা ক্লাস',
    mostUrgent: 'সবচেয়ে জরুরি: ৮ম ক শাখার উপস্থিতি নেওয়া বাকি।',
    action: <Button>উপস্থিতি নিন</Button>,
  },
};

export const AccountantWithAction: Story = {
  args: {
    icon: <BanknoteIcon className="size-5" />,
    headline: 'আজ ক্যাশে ৫টা বিষয় দেখার আছে',
    mostUrgent: 'সবচেয়ে জরুরি: ১২টা বকেয়া ফি-র তারিখ পার হয়েছে।',
    action: <Button>বকেয়া দেখুন</Button>,
  },
};

export const CommitteeSummary: Story = {
  args: {
    headline: 'এই সপ্তাহে স্কুলের অবস্থা স্থিতিশীল',
    mostUrgent: 'উপস্থিতি ৯১%, ফি আদায় ৮৪%।',
    caption: 'আজ সকাল ৯টায় আপডেট',
  },
};

export const Loading: Story = {
  args: { headline: '', loading: true, loadingLabel: 'লোড হচ্ছে' },
};

const mobile = { viewport: { defaultViewport: 'mobile1' } };

export const PhoneCollapsed: Story = { ...Headmaster, parameters: mobile };

export const PhoneExpanded: Story = {
  ...Headmaster,
  parameters: mobile,
  play: async ({ canvasElement }) => {
    const toggle = within(canvasElement).getByRole('button', { name: 'আরও ৩টা বিষয়' });
    await userEvent.click(toggle);
    await expect(toggle.getAttribute('aria-expanded')).toBe('true');
  },
};

export const Dark: Story = {
  ...Headmaster,
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
};
