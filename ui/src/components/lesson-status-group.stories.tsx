import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { LessonStatusGroup, type LessonDeliveryStatus } from './lesson-status-group';

const meta: Meta<typeof LessonStatusGroup> = {
  title: 'Components/LessonStatusGroup',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof LessonStatusGroup>;

const en = { TAUGHT: 'Taught', PARTLY: 'Partly', NOT_TAUGHT: 'Not taught' };
const bn = { TAUGHT: 'পড়ানো হয়েছে', PARTLY: 'আংশিক', NOT_TAUGHT: 'হয়নি' };

function Controlled(props: {
  initial: LessonDeliveryStatus | null;
  labels?: typeof en;
  groupLabel?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = React.useState(props.initial);
  return (
    <LessonStatusGroup
      value={value}
      onChange={setValue}
      labels={props.labels ?? en}
      groupLabel={props.groupLabel ?? 'Period 1 status'}
      {...(props.disabled ? { disabled: true } : {})}
    />
  );
}

export const Unmarked: Story = { render: () => <Controlled initial={null} /> };
export const Taught: Story = { render: () => <Controlled initial="TAUGHT" /> };
export const Partly: Story = { render: () => <Controlled initial="PARTLY" /> };
export const NotTaught: Story = { render: () => <Controlled initial="NOT_TAUGHT" /> };
export const Disabled: Story = { render: () => <Controlled initial="TAUGHT" disabled /> };

export const Bangla: Story = {
  render: () => <Controlled initial="PARTLY" labels={bn} groupLabel="১ম পিরিয়ডের অবস্থা" />,
};

/** Narrow canvas: 56px stacked (icon over word) buttons. */
export const Phone390: Story = {
  render: () => <Controlled initial="TAUGHT" labels={bn} groupLabel="১ম পিরিয়ডের অবস্থা" />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
