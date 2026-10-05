import type { Meta, StoryObj } from '@storybook/react-vite';

import { PasswordChecklist } from './password-checklist';

const meta: Meta<typeof PasswordChecklist> = {
  title: 'Components/PasswordChecklist',
  component: PasswordChecklist,
  tags: ['autodocs'],
  args: { password: '', audience: 'staff' },
};

export default meta;
type Story = StoryObj<typeof PasswordChecklist>;

export const Empty: Story = {};
export const PartlyMet: Story = { args: { password: 'abcdefgh' } };
export const AllMet: Story = { args: { password: 'Strong-pass1' } };
export const Family: Story = { args: { password: 'abcdefgh', audience: 'family' } };
