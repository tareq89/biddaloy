import type { Meta, StoryObj } from '@storybook/react-vite';

import { ImpersonationBanner } from './impersonation-banner';

const meta = {
  title: 'Components/ImpersonationBanner',
  component: ImpersonationBanner,
  args: {
    message: 'You are viewing as Rahim Uddin (Teacher)',
    remainingSeconds: 1800,
    endLabel: 'End',
    warningLabel: 'Less than 5 minutes left',
    onEnd: () => {},
  },
} satisfies Meta<typeof ImpersonationBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Warning: Story = { args: { remainingSeconds: 240 } };
export const ViewOnly: Story = { args: { viewOnlyLabel: 'View only' } };
export const Phone: Story = {
  args: { viewOnlyLabel: 'View only' },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
export const Bangla: Story = {
  args: {
    message: 'আপনি রহিম উদ্দিন (শিক্ষক) হিসেবে দেখছেন',
    endLabel: 'শেষ করুন',
    warningLabel: 'আর ৫ মিনিটের কম বাকি',
    remainingSeconds: 240,
  },
};
