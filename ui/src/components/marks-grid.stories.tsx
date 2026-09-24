import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { MarksGrid, cellKey, type MarksGridCell } from './marks-grid';

const meta: Meta<typeof MarksGrid> = {
  title: 'Components/MarksGrid',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof MarksGrid>;

const students = [
  { id: 's1', roll_number: 1, full_name: 'Rafi Ahmed' },
  { id: 's2', roll_number: 2, full_name: 'Nadia Islam' },
  { id: 's3', roll_number: 3, full_name: 'Karim Sheikh' },
];

const components = [
  { id: 'c1', name: 'Written', source: 'MANUAL' as const, full_marks: '100' },
  { id: 'c2', name: 'MCQ', source: 'MANUAL' as const, full_marks: '25' },
  { id: 'c3', name: 'Attendance', source: 'DERIVED' as const, full_marks: '10' },
];

const partialCells: MarksGridCell[] = [
  { student_id: 's1', component_id: 'c1', value: '82', status: 'PRESENT' },
  { student_id: 's1', component_id: 'c2', value: '20', status: 'PRESENT' },
  { student_id: 's2', component_id: 'c1', value: null, status: 'ABSENT' },
];

const derived = { c3: { values: { s1: '10', s2: '8', s3: '9' } } };

function Interactive(props: { cells: MarksGridCell[]; readOnly?: boolean }) {
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  return (
    <MarksGrid
      students={students}
      components={components}
      cells={props.cells}
      derived={derived}
      readOnly={Boolean(props.readOnly)}
      pendingKeys={pendingKeys}
      onStage={(key) => {
        setPendingKeys((prev) => new Set(prev).add(key));
        setTimeout(
          () =>
            setPendingKeys((prev) => {
              const next = new Set(prev);
              next.delete(key);
              return next;
            }),
          800,
        );
      }}
    />
  );
}

export const Empty: Story = {
  render: () => <MarksGrid students={[]} components={components} cells={[]} onStage={() => {}} />,
};

export const PartiallyFilled: Story = {
  render: () => <Interactive cells={partialCells} />,
};

export const Submitted: Story = {
  render: () => <Interactive cells={partialCells} readOnly />,
};

export const ErrorState: Story = {
  render: () => (
    <MarksGrid
      students={students}
      components={components}
      cells={partialCells}
      derived={derived}
      failedKeys={new Set([cellKey('s2', 'c1')])}
      onStage={() => {}}
    />
  ),
};
