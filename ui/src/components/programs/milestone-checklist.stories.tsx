import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { MilestoneChecklist } from './milestone-checklist';

const meta: Meta<typeof MilestoneChecklist> = {
  title: 'Components/Programs/MilestoneChecklist',
  component: MilestoneChecklist,
  tags: ['autodocs'],
  args: {
    onRecord: fn(),
    onUndo: fn(),
    undoLabel: 'Undo',
  },
};

export default meta;
type Story = StoryObj<typeof MilestoneChecklist>;

export const Empty: Story = {
  args: {
    items: [],
    emptyMessage: 'No milestones yet',
  },
};

export const Partial: Story = {
  args: {
    items: [
      { id: 'm-1', name: 'Read 5 books', achievedOn: '2026-01-15', scoreGrade: null, remark: null },
      { id: 'm-2', name: 'Write a book report', achievedOn: null, scoreGrade: null, remark: null },
      { id: 'm-3', name: 'Present to class', achievedOn: null, scoreGrade: null, remark: null },
    ],
  },
};

export const Complete: Story = {
  args: {
    items: [
      {
        id: 'm-1',
        name: 'Read 5 books',
        achievedOn: '2026-01-15',
        scoreGrade: 'A+',
        remark: 'Excellent pace',
      },
      {
        id: 'm-2',
        name: 'Write a book report',
        achievedOn: '2026-02-01',
        scoreGrade: null,
        remark: null,
      },
      {
        id: 'm-3',
        name: 'Present to class',
        achievedOn: '2026-02-10',
        scoreGrade: '9/10',
        remark: null,
      },
    ],
  },
};
