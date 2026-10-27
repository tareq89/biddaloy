import { HomeworkGradingMode, HomeworkSubmissionStatus } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { SubmissionGrid, type SubmissionRow } from './-submission-grid';

const rows: SubmissionRow[] = [
  {
    id: 'st-1',
    student_id: 'st-1',
    student_name: 'Karim Rahman',
    roll_number: 1,
    status: HomeworkSubmissionStatus.NOT_SUBMITTED,
    marks: null,
  },
  {
    id: 'st-2',
    student_id: 'st-2',
    student_name: 'Rahim Uddin',
    roll_number: 2,
    status: HomeworkSubmissionStatus.SUBMITTED,
    marks: null,
  },
  {
    id: 'st-3',
    student_id: 'st-3',
    student_name: 'Nusrat Jahan',
    roll_number: 3,
    status: HomeworkSubmissionStatus.DONE,
    marks: 8,
  },
];

/** #2899: the per-student check-work list. Status is a badge; Save is sticky and sends one request. */
const meta: Meta<typeof SubmissionGrid> = {
  title: 'Homework/SubmissionGrid',
  component: SubmissionGrid,
  args: { rows, onSave: () => Promise.resolve([]) },
};
export default meta;

type Story = StoryObj<typeof SubmissionGrid>;

export const Tick: Story = { args: { gradingMode: HomeworkGradingMode.TICK } };
export const Partial: Story = { args: { gradingMode: HomeworkGradingMode.PARTIAL } };
export const Marks: Story = { args: { gradingMode: HomeworkGradingMode.MARKS } };

/** Types 10000 and presses Save: the row shows the marks error and nothing is sent. */
export const MarksError: Story = {
  args: { gradingMode: HomeworkGradingMode.MARKS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = await canvas.findByRole('spinbutton', { name: /Karim Rahman/i });
    await userEvent.type(input, '10000');
    await userEvent.click(canvas.getByRole('button', { name: /save/i }));
    await expect(await canvas.findByRole('alert')).toBeTruthy();
  },
};
