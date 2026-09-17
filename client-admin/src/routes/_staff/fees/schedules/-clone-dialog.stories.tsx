import type { Meta, StoryObj } from '@storybook/react-vite';

import { CloneScheduleDialog } from './-clone-dialog';

/**
 * #679's "Clone for next year" dialog — the row action that copies a
 * schedule's fees/audience/rule into a new schedule under a different
 * academic year.
 */
const meta: Meta<typeof CloneScheduleDialog> = {
  component: CloneScheduleDialog,
  args: {
    open: true,
    onOpenChange: () => {},
    onCloned: () => {},
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
export default meta;

type Story = StoryObj<typeof CloneScheduleDialog>;

export const Default: Story = {};
