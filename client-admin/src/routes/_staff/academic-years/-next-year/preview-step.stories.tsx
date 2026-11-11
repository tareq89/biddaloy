import { YEAR_ROLLOVER_BLOCKS } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { PreviewStep } from './preview-step';

/** Step 2 of Create next year. Same "client-admin is not globbed into Storybook yet" note as
 * `-terms-tab-view.stories.tsx`; written anyway so it is ready once that is wired. */
const meta: Meta<typeof PreviewStep> = {
  component: PreviewStep,
  args: {
    yearName: '2026-2027',
    isPending: false,
    isError: false,
    onRetry: () => undefined,
    onToggle: () => undefined,
    included: new Set(YEAR_ROLLOVER_BLOCKS),
  },
};
export default meta;

type Story = StoryObj<typeof PreviewStep>;

const block = (created: number, existing = 0) => ({ created, existing, skipped: [] });

const PREVIEW = {
  target_year_id: null,
  classes: block(12, 0),
  sections: block(24),
  class_subjects: block(96),
  teacher_assignments: { created: 40, existing: 0, skipped: [{ name: 'x', reason: 'no section' }] },
  fee_structures: block(18),
  grading_scales: block(1),
  terms: block(3),
  skipped_staff: [
    { teacher_name: 'Rahim Uddin', section: 'Class 6 A', subject: 'Math' },
    { teacher_name: 'Salma Akter', section: 'Class 7 B', subject: 'English' },
  ],
};

/** New year, nothing there yet; two teachers have no matching section and are listed by name. */
export const WithSkippedStaff: Story = { args: { preview: PREVIEW } };

/** Re-run: the year already has the classes, so they read "already there". */
export const RerunAlreadyThere: Story = {
  args: { preview: { ...PREVIEW, classes: block(0, 12), skipped_staff: [] } },
};

export const Loading: Story = { args: { preview: undefined, isPending: true } };

export const Failed: Story = { args: { preview: undefined, isError: true } };

/** Every block unticked: the footer's Create year is off and this line says why. */
export const NothingTicked: Story = { args: { preview: PREVIEW, included: new Set() } };
