import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { MySyllabusProgressView, type MySyllabusProgressDto } from './my-syllabus-progress.widget';

const item = (
  id: string,
  className: string,
  en: string,
  bn: string,
  done: number,
  expected: number | null = null,
) => ({
  class_id: `c-${id}`,
  class_name: className,
  sections: [{ section_id: `s-${id}`, section_name: 'A' }],
  subject_id: `sub-${id}`,
  subject_name_en: en,
  subject_name_bn: bn,
  done,
  total: 100,
  percentage: done,
  expected_percentage: expected,
});

const data: MySyllabusProgressDto = {
  behind_count: 0,
  items: [
    item('1', '6', 'Math', 'গণিত', 80),
    item('2', '7', 'Science', 'বিজ্ঞান', 30),
    item('3', '8', 'English', 'ইংরেজি', 60),
  ],
};

/** With study plans: Science is 17% behind where it should be by today. */
const withPlan: MySyllabusProgressDto = {
  behind_count: 1,
  items: [
    item('1', '6', 'Math', 'গণিত', 80, 78),
    item('2', '7', 'Science', 'বিজ্ঞান', 30, 47),
    item('3', '8', 'English', 'ইংরেজি', 60, 55),
  ],
};

const meta: Meta<typeof MySyllabusProgressView> = {
  title: 'Dashboard/Widgets/MySyllabusProgress',
  component: MySyllabusProgressView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof MySyllabusProgressView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const BehindThePlan: Story = {
  args: { data: withPlan },
  globals: { locale: 'bn' },
};
export const Compact: Story = { args: { variant: 'compact' } };
export const Empty: Story = { args: { data: { items: [], behind_count: 0 } } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };
export const Loading: Story = { args: { data: undefined, loading: true } };
