import type { PreviewResult } from '@biddaloy/ui/hooks';
import type { BulkUploadResult, StudentUploadSummary } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ImportDoneSummary, ImportPreviewSummary } from '../import';

/**
 * [14.9.2]'s two page-level states for `/students/import`: the preview an
 * admin sees before confirming (with row errors, so Confirm would be
 * disabled) and the done screen after a successful commit.
 *
 * Same Storybook-not-wired-for-`client-admin` gap `-create-school-
 * wizard.stories.tsx` notes — only `ui/src/**` is globbed into this
 * repo's Storybook config today, so this file isn't reachable from a
 * running Storybook instance yet. Written anyway, following that file's
 * precedent, so it's ready once that wiring gap is fixed.
 */

function previewResult(
  overrides: Partial<PreviewResult<StudentUploadSummary>> = {},
): PreviewResult<StudentUploadSummary> {
  return {
    staging_id: 'staging-1',
    expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    errors: [],
    hard_error_count: 0,
    summary: {
      rows_to_create: 3,
      preview: [
        {
          row: 2,
          student_name: 'Karim Rahman',
          class: 'Class 5',
          section: 'A',
          guardian1_phone: '+8801711111111',
        },
        {
          row: 3,
          student_name: 'Rahim Uddin',
          class: 'Class 5',
          section: 'A',
          guardian1_phone: '+8801711111112',
        },
        {
          row: 4,
          student_name: 'Fatema Begum',
          class: 'Class 5',
          section: 'B',
          guardian1_phone: '+8801711111113',
        },
      ],
    },
    ...overrides,
  };
}

const previewMeta: Meta<typeof ImportPreviewSummary> = {
  component: ImportPreviewSummary,
};
export default previewMeta;

type PreviewStory = StoryObj<typeof ImportPreviewSummary>;

export const PreviewWithErrors: PreviewStory = {
  args: {
    result: previewResult({
      summary: {
        rows_to_create: 1,
        preview: [
          {
            row: 2,
            student_name: 'Karim Rahman',
            class: 'Class 5',
            section: 'A',
            guardian1_phone: '+8801711111111',
          },
        ],
      },
      errors: [
        {
          row: 3,
          column: 'guardian1_phone',
          message: 'Invalid phone format: guardian1_phone',
          value: '০১৭১২৩৪৫৬৭',
          severity: 'error',
        },
      ],
      hard_error_count: 1,
    }),
  },
};

export const PreviewClean: PreviewStory = {
  args: { result: previewResult() },
};

function doneResult(overrides: Partial<BulkUploadResult> = {}): BulkUploadResult {
  return {
    total_rows: 3,
    success_count: 3,
    error_count: 0,
    created_student_ids: ['s-1', 's-2', 's-3'],
    errors: [],
    ...overrides,
  };
}

export const Done: StoryObj<typeof ImportDoneSummary> = {
  render: (args) => <ImportDoneSummary {...args} />,
  args: {
    result: doneResult(),
    onImportAnother: () => {},
  },
};
