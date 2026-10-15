import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { AtRiskView, type AtRiskDto } from './at-risk-students.widget';

const student = (i: number, signals: AtRiskDto['students'][number]['signals']) => ({
  student_id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`,
  full_name: ['সাদিয়া ইসলাম', 'Rafiq Hasan', 'তানভীর আহমেদ', 'Nusrat Jahan'][i % 4]!,
  class_name: '৮ম',
  section_name: 'ক',
  signals,
});
const data: AtRiskDto = {
  state: 'READY',
  computed_at: '2026-10-07T18:30:04Z',
  stale: false,
  thresholds: { absentStreakDays: 3, monthlyAttendancePct: 75, failedSubjects: 1, overdueDays: 60 },
  total: 12,
  week_ago_total: 9,
  new_this_week: 3,
  students: [
    student(0, [
      { kind: 'ABSENT_STREAK', value: 4 },
      { kind: 'OVERDUE', value: 65 },
      {
        kind: 'FAILED_SUBJECTS',
        value: 1,
        subjects: [{ name_en: 'Mathematics', name_bn: 'গণিত' }],
      },
    ]),
    ...Array.from({ length: 11 }, (_, i) =>
      student(i + 1, [
        { kind: 'LOW_ATTENDANCE', value: 70 },
        { kind: 'OVERDUE', value: 62 + i },
      ]),
    ),
  ],
};

const meta: Meta<typeof AtRiskView> = {
  title: 'Dashboard/Widgets/AtRiskStudents',
  component: AtRiskView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-3xl">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof AtRiskView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Expanded: Story = { args: { defaultExpanded: true } };
export const PhoneCards: Story = { parameters: { viewport: { defaultViewport: 'mobile1' } } };
export const Compact: Story = { args: { variant: 'compact' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Computing: Story = { args: { data: { ...data, state: 'COMPUTING', students: [] } } };
export const Empty: Story = { args: { data: { ...data, total: 0, students: [] } } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
