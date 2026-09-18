import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { GenerateFeesModal } from './generate-fees-modal';

/**
 * [16.3.6]'s single-modal replacement for the old wizard — empty (no
 * duplicates, nothing selected yet) and the duplicates step it shows
 * inline once a preview finds a clash.
 *
 * Same Storybook-not-wired-for-`client-admin` gap `-create-school-
 * wizard.stories.tsx` notes — only `ui/src/**` is globbed into this
 * repo's Storybook config today, so this file isn't reachable from a
 * running Storybook instance yet. Written anyway, following that file's
 * precedent, so it's ready once that wiring gap is fixed.
 */
const meta: Meta<typeof GenerateFeesModal> = {
  component: GenerateFeesModal,
  args: {
    open: true,
    onOpenChange: () => undefined,
  },
};
export default meta;

type Story = StoryObj<typeof GenerateFeesModal>;

export const Empty: Story = {};

export const Duplicates: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post('/api/v1/fees/generate/preview', () =>
          HttpResponse.json({
            students_total: 30,
            would_generate: 28,
            duplicates: [
              {
                student_id: 'student-1',
                fee_structure_id: 'fee-1',
                existing_bill_id: 'existing-1',
                paid_amount: 500,
              },
              {
                student_id: 'student-2',
                fee_structure_id: 'fee-1',
                existing_bill_id: 'existing-2',
                paid_amount: 500,
              },
            ],
            inactive: [{ id: 'student-3', full_name: 'Fatema Begum' }],
          }),
        ),
      ],
    },
  },
};
