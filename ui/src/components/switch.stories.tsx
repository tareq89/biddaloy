/**
 * No "Loading" story: a switch has no loading state of its own — a pending
 * save is a call-site concern (disable it while pending).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Switch } from './switch';

const meta: Meta<typeof Switch> = {
  title: 'Components/Switch',
  component: Switch,
  tags: ['autodocs'],
  args: { 'aria-label': 'Escalate late attendance' },
};

export default meta;
type Story = StoryObj<typeof Switch>;

export const Off: Story = {};

export const On: Story = { args: { defaultChecked: true } };

/** A locked "on" setting (an urgent alert rule that cannot be switched off). */
export const DisabledOn: Story = {
  args: { defaultChecked: true, disabled: true, 'aria-label': 'Backup failed' },
  render: (args) => (
    <div className="flex items-center gap-3">
      <Switch {...args} />
      <span className="text-label text-text-secondary">Can&apos;t be switched off</span>
    </div>
  ),
};

export const Bangla: Story = {
  args: { 'aria-label': 'উপস্থিতি অনেক দেরি হলে জানান', defaultChecked: true },
  decorators: [rtlDecorator],
};
