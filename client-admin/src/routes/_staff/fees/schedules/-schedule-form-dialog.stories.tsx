import type { Meta, StoryObj } from '@storybook/react-vite';

import { ScheduleFormDialog } from './-schedule-form-dialog';

/**
 * #679's create/edit dialog — covers the states the issue's acceptance
 * criteria call out by name: a fresh create form, an edit form reopened
 * with a saved monthly rule, and an edit form reopened with a saved
 * weekly rule. `useAcademicYears`/`useFeeStructures`/etc. fire real
 * requests in Storybook (no MSW wiring in this repo's Storybook yet,
 * same gap other dialogs' stories note) — harmless since nobody submits
 * the form from a story.
 */
const meta: Meta<typeof ScheduleFormDialog> = {
  component: ScheduleFormDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    onSaved: () => {},
  },
};
export default meta;

type Story = StoryObj<typeof ScheduleFormDialog>;

export const Create: Story = {
  args: {
    mode: 'create',
  },
};

export const EditMonthlyRule: Story = {
  args: {
    mode: 'edit',
    schedule: {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Monthly tuition',
      academic_year_id: '00000000-0000-4000-8000-000000000010',
      fee_structure_ids: ['00000000-0000-4000-8000-000000000020'],
      audience: { class_id: null, section_id: null, active_only: true },
      rule: { mode: 'MONTHLY', day_of_month: 5 },
      due_days_after_period_start: 7,
      starts_on: '2026-01-01',
      ends_on: '2026-12-31',
      notify_families: true,
      is_active: true,
      last_run_period: '2026-08',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  },
};

export const EditWeeklyRule: Story = {
  args: {
    mode: 'edit',
    schedule: {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Weekly transport',
      academic_year_id: '00000000-0000-4000-8000-000000000010',
      fee_structure_ids: ['00000000-0000-4000-8000-000000000021'],
      audience: { class_id: null, section_id: null, active_only: true },
      rule: { mode: 'WEEKLY', weekdays: ['MON', 'THU'] },
      due_days_after_period_start: 2,
      starts_on: '2026-01-01',
      ends_on: null,
      notify_families: false,
      is_active: true,
      last_run_period: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  },
};
