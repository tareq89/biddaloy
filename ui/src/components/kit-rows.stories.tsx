import type { Meta, StoryObj } from '@storybook/react-vite';

import { ExamMarkerRow } from './exam-marker-row';
import { ReorderButtons } from './reorder-buttons';
import { Table, TableBody, TableCell, TableRow } from './table';

const lessons = ['Lesson 1', 'Lesson 2', 'Lesson 3'];

function Demo({ withEdit }: { withEdit?: boolean }) {
  return (
    <Table>
      <TableBody>
        {lessons.map((name, i) => (
          <TableRow key={name}>
            <TableCell>{name}</TableCell>
            <TableCell className="text-end">
              <ReorderButtons
                index={i}
                count={lessons.length}
                onMove={() => {}}
                upLabel={`Move ${name} up`}
                downLabel={`Move ${name} down`}
              />
            </TableCell>
          </TableRow>
        ))}
        <ExamMarkerRow
          colSpan={2}
          title="Half-yearly syllabus ends here"
          meta="Lessons 1-3 · 2 taught"
          {...(withEdit ? { onEdit: () => {} } : {})}
          editLabel="Edit marker"
        />
      </TableBody>
    </Table>
  );
}

const meta: Meta<typeof Demo> = {
  title: 'Components/ReorderButtons and ExamMarkerRow',
  component: Demo,
};

export default meta;
type Story = StoryObj<typeof Demo>;

export const Default: Story = {};
export const WithEdit: Story = { args: { withEdit: true } };
