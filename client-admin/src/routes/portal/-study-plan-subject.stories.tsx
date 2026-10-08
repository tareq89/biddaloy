import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { StudyPlanSubject, type FamilySubjectPlan } from './-study-plan-subject';

/**
 * [66.3] The expanded body of one subject on `/portal/syllabus`. Same
 * "client-admin isn't globbed into a running Storybook" precedent as
 * `-portal-calendar-view.stories.tsx`: presentational, no data hooks.
 */
const meta: Meta<typeof StudyPlanSubject> = {
  component: StudyPlanSubject,
  decorators: [
    (Story) => (
      <RegionConfigProvider>
        <Story />
      </RegionConfigProvider>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof StudyPlanSubject>;

const base: FamilySubjectPlan = {
  subject: { id: 's-math', name_en: 'Mathematics', name_bn: 'গণিত' },
  plan_id: 'plan-math',
  teacher_names: ['Mr Karim'],
  last_taught: { number: 18, title: 'Fractions', date: '2026-05-12' },
  next: [
    { number: 19, title: 'Decimals', expected_date: '2026-05-13' },
    { number: 20, title: 'Percent', expected_date: '2026-05-14' },
    { number: 21, title: 'Ratio', expected_date: '2026-05-17' },
  ],
  expected_finish_date: '2026-07-01',
  periods_behind: 4,
  lessons_behind: 2,
  lessons_done: 18,
  lessons_total: 40,
  exam_syllabus: [
    {
      exam_id: 'e1',
      exam_name: 'Half-yearly',
      exam_date: '2026-06-14',
      lessons_in_syllabus: 21,
      lessons_taught: 18,
    },
  ],
};

export const Behind: Story = { args: { plan: base } };
export const OnTime: Story = {
  args: { plan: { ...base, lessons_behind: 0, periods_behind: 0, exam_syllabus: [] } },
};
export const NotStarted: Story = {
  args: {
    plan: { ...base, last_taught: null, lessons_done: 0, lessons_behind: 0, exam_syllabus: [] },
  },
};
