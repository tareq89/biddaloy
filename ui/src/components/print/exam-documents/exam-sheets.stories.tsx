import type { Meta, StoryObj } from '@storybook/react-vite';

import type { IssuerSnapshot } from '../issuer-header';

import { BlankMarksSheet, ExamRoutineNotice, type RoutineRow } from './exam-sheets';

const meta: Meta = { title: 'Print/ExamDocuments/ExamSheets', tags: ['autodocs'] };
export default meta;
type Story = StoryObj;

const ISSUER: IssuerSnapshot = {
  name: 'Ananta High School',
  name_bn: 'অনন্ত উচ্চ বিদ্যালয়',
  address: '123 Green Road, Dhaka-1205',
  phone: '01700000000',
  email: null,
  registration_id: '123456',
  logo_key: null,
};

const base = { issuer: ISSUER, examName: 'Half Yearly 2026', printedOn: 'Printed: 8 Oct 2026' };

export const MarksSheet45: Story = {
  render: () => (
    <BlankMarksSheet
      {...base}
      labels={{ roll: 'Roll', name: 'Name', total: 'Total', teacher: 'Class teacher' }}
      pages={[
        {
          className: 'Class 6',
          section: 'A',
          subject: 'Bangla 1st paper',
          components: [
            { name: 'CQ', fullMarks: 70 },
            { name: 'MCQ', fullMarks: 30 },
          ],
          students: Array.from({ length: 45 }, (_, i) => ({
            roll: i + 1,
            name: `Student number ${i + 1}`,
          })),
        },
      ]}
    />
  ),
};

const subjects = [
  'Bangla',
  'English',
  'Maths',
  'Science',
  'Social',
  'Religion',
  'ICT',
  'Art',
  'PE',
];
const rows: RoutineRow[] = subjects.map((subject, i) => ({
  date: `${18 + i} Oct 2026`,
  day: 'Sunday',
  subject,
  time: '10:00 – 1:00',
}));

export const Routine9: Story = {
  render: () => (
    <ExamRoutineNotice
      {...base}
      className="Class 6"
      rows={rows}
      labels={{
        title: 'Exam routine',
        date: 'Date',
        day: 'Day',
        subject: 'Subject',
        time: 'Time',
        headTeacher: 'Head teacher',
      }}
    />
  ),
};
