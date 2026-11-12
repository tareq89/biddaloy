import type { Meta, StoryObj } from '@storybook/react-vite';

import { PersonPicker } from './person-picker';

const meta = {
  title: 'Components/PersonPicker',
  component: PersonPicker,
  args: {
    items: [
      { id: 'a', name: 'Rahim Uddin', meta: 'Class 5, Roll 3' },
      { id: 'b', name: 'Karim Ali', meta: 'Class 6, Roll 8', disabledReason: 'No contact on file' },
      { id: 'c', name: 'Salma Khatun', meta: 'Class 7, Roll 1' },
    ],
    value: undefined,
    onValueChange: () => {},
    onSearchChange: () => {},
    searchLabel: 'Search people',
    emptyLabel: 'Nobody matches',
    label: 'People',
  },
} satisfies Meta<typeof PersonPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Selected: Story = { args: { value: 'a' } };
export const DisabledRows: Story = {};
export const Empty: Story = { args: { items: [] } };
export const Phone: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Bangla: Story = {
  args: {
    items: [
      { id: 'a', name: 'রহিম উদ্দিন', meta: 'পঞ্চম শ্রেণি, রোল ৩' },
      {
        id: 'b',
        name: 'করিম আলী',
        meta: 'ষষ্ঠ শ্রেণি, রোল ৮',
        disabledReason: 'যোগাযোগের তথ্য নেই',
      },
    ],
    searchLabel: 'খুঁজুন',
    emptyLabel: 'কাউকে পাওয়া যায়নি',
    label: 'ব্যক্তি',
  },
};
