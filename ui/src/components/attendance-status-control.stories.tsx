import { AttendanceStatus } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { AttendanceStatusControl } from './attendance-status-control';

const meta: Meta<typeof AttendanceStatusControl> = {
  title: 'Components/AttendanceStatusControl',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AttendanceStatusControl>;

function Controlled(props: {
  initialValue: AttendanceStatus | null;
  initialMinutesLate?: number | null;
  variant?: 'compact' | 'expanded';
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState<AttendanceStatus | null>(props.initialValue);
  const [minutesLate, setMinutesLate] = React.useState<number | null>(
    props.initialMinutesLate ?? null,
  );
  return (
    <AttendanceStatusControl
      value={value}
      onChange={setValue}
      minutesLate={minutesLate}
      onMinutesLateChange={setMinutesLate}
      studentName="Rafi Ahmed"
      {...(props.variant ? { variant: props.variant } : {})}
      {...(props.disabled ? { disabled: true } : {})}
    />
  );
}

export const Unmarked: Story = {
  render: () => <Controlled initialValue={null} />,
};

export const Present: Story = {
  render: () => <Controlled initialValue={AttendanceStatus.PRESENT} />,
};

export const Absent: Story = {
  render: () => <Controlled initialValue={AttendanceStatus.ABSENT} />,
};

export const LateWithMinutes: Story = {
  render: () => <Controlled initialValue={AttendanceStatus.LATE} initialMinutesLate={12} />,
};

export const Leave: Story = {
  render: () => <Controlled initialValue={AttendanceStatus.LEAVE} />,
};

export const Disabled: Story = {
  render: () => <Controlled initialValue={AttendanceStatus.PRESENT} disabled />,
};

export const ExpandedVariant: Story = {
  render: () => (
    <Controlled initialValue={AttendanceStatus.LATE} initialMinutesLate={7} variant="expanded" />
  ),
};

export const Bengali: Story = {
  render: () => <Controlled initialValue={AttendanceStatus.ABSENT} />,
  globals: { locale: 'bn' },
};

export const RightToLeft: Story = {
  render: () => <Controlled initialValue={AttendanceStatus.LATE} initialMinutesLate={3} />,
  decorators: [rtlDecorator],
};
