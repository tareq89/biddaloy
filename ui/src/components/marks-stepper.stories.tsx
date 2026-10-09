import type { Meta, StoryObj } from '@storybook/react-vite';

import { cellKey, type MarksGridCell } from './marks-grid';
import { MarksStepper } from './marks-stepper';

const meta: Meta<typeof MarksStepper> = {
  title: 'Components/MarksStepper',
  tags: ['autodocs'],
  parameters: {
    viewport: { defaultViewport: 'mobile1' },
  },
};

export default meta;
type Story = StoryObj<typeof MarksStepper>;

const students = [
  { id: 's1', roll_number: 1, full_name: 'Rafi Ahmed' },
  { id: 's2', roll_number: 2, full_name: 'Nadia Islam' },
];

const components = [
  { id: 'c1', name: 'Written', source: 'MANUAL' as const, full_marks: '100' },
  { id: 'c3', name: 'Attendance', source: 'DERIVED' as const, full_marks: '10' },
];

const partialCells: MarksGridCell[] = [
  { student_id: 's1', component_id: 'c1', value: '82', status: 'PRESENT' },
];

const derived = { c3: { values: { s1: '10', s2: '9' } } };

export const Empty: Story = {
  render: () => (
    <MarksStepper students={[]} components={components} cells={[]} onStage={() => {}} />
  ),
};

export const PartiallyFilled: Story = {
  render: () => (
    <MarksStepper
      students={students}
      components={components}
      cells={partialCells}
      derived={derived}
      onStage={() => {}}
    />
  ),
};

export const Submitted: Story = {
  render: () => (
    <MarksStepper
      students={students}
      components={components}
      cells={partialCells}
      derived={derived}
      readOnly
      onStage={() => {}}
    />
  ),
};

export const ErrorState: Story = {
  render: () => (
    <MarksStepper
      students={students}
      components={components}
      cells={partialCells}
      derived={derived}
      failedKeys={new Set([cellKey('s1', 'c1')])}
      onStage={() => {}}
    />
  ),
};
