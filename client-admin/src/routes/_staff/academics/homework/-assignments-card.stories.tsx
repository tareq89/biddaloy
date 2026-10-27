import { HomeworkAssignmentStatus } from '@biddaloy/shared';
import type { HomeworkAssignmentListItem } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { AssignmentsCard } from './-assignments-card';

/** #1013's "Who has this homework" card: a section row, a student row, a superseded row. */
const row = (over: Partial<HomeworkAssignmentListItem>): HomeworkAssignmentListItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  homework_id: '00000000-0000-4000-8000-0000000000aa',
  section_id: '00000000-0000-4000-8000-0000000000b1',
  student_id: null,
  assigned_date: '2026-10-20',
  due_date: '2026-10-30',
  status: HomeworkAssignmentStatus.ACTIVE,
  target_section_id: '00000000-0000-4000-8000-0000000000b1',
  section_name: 'A',
  student_name: null,
  ...over,
});

const meta: Meta<typeof AssignmentsCard> = {
  component: AssignmentsCard,
  args: {
    loading: false,
    error: false,
    onRetry: () => undefined,
    onAssign: () => undefined,
    actionsFor: (r) =>
      r.status === HomeworkAssignmentStatus.SUPERSEDED
        ? []
        : [{ intent: 'edit', label: `Change ${r.section_name}`, shortLabel: 'Change' }],
  },
};
export default meta;

type Story = StoryObj<typeof AssignmentsCard>;

export const Mixed: Story = {
  args: {
    assignments: [
      row({}),
      row({
        id: '00000000-0000-4000-8000-000000000002',
        section_id: null,
        student_id: '00000000-0000-4000-8000-0000000000c1',
        section_name: 'B',
        student_name: 'Rahim Uddin',
        due_date: '2026-10-28',
      }),
      row({
        id: '00000000-0000-4000-8000-000000000003',
        status: HomeworkAssignmentStatus.SUPERSEDED,
        due_date: '2026-10-27',
      }),
    ],
  },
};

export const Empty: Story = { args: { assignments: [] } };

export const Loading: Story = { args: { loading: true } };

export const Error: Story = { args: { error: true } };
