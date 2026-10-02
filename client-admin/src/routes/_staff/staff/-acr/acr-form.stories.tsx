import type { AcrAssessment, AcrCriterion } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AcrForm } from './acr-form';
import { CriterionStep } from './criterion-step';

/**
 * [28.3.2] The ACR form's states: the wizard (step 1), the criteria step
 * (desktop list, and the phone's one-criterion-per-screen via the
 * viewport toolbar), and a completed, read-only ACR.
 *
 * Same Storybook-not-wired-for-`client-admin` gap
 * `restore-wizard.stories.tsx` notes — written to that precedent so it is
 * ready once the wiring lands.
 */

const criteria: AcrCriterion[] = [
  {
    id: 'c1',
    block: 'BLOCK_2',
    code: 'PUNCTUALITY',
    label_en: 'Punctuality',
    label_bn: 'সময়ানুবর্তিতা',
    sort_order: 1,
  },
  {
    id: 'c2',
    block: 'BLOCK_2',
    code: 'LESSON_PLANS',
    label_en: 'Lesson plans',
    label_bn: 'পাঠ পরিকল্পনা',
    sort_order: 2,
  },
  {
    id: 'c3',
    block: 'BLOCK_3',
    code: 'TEAMWORK',
    label_en: 'Teamwork',
    label_bn: 'দলগত কাজ',
    sort_order: 1,
  },
];

function assessment(overrides: Partial<AcrAssessment> = {}): AcrAssessment {
  return {
    id: 'acr-1',
    user_id: 'user-1',
    academic_year_id: 'year-1',
    form_version_id: 'version-1',
    status: 'INCOMPLETE',
    total: null,
    assessed_by: 'admin-1',
    step1_data: {
      period_from: '2026-01-01',
      period_to: '2026-12-31',
      description: 'Teaches maths',
    },
    step3_data: null,
    completed_at: null,
    scores: [],
    ...overrides,
  };
}

const meta: Meta<typeof AcrForm> = {
  component: AcrForm,
  decorators: [
    (Story) => (
      <QueryClientProvider client={new QueryClient()}>
        <Story />
      </QueryClientProvider>
    ),
  ],
  args: { criteria, onServerUpdate: () => undefined },
};
export default meta;

type Story = StoryObj<typeof AcrForm>;

/** Step 1 — period, employment duration, description. */
export const PeriodStep: Story = { args: { assessment: assessment() } };

/** Partly scored — the wizard opens on step 1; Next to reach the criteria. */
export const PartiallyScored: Story = {
  args: { assessment: assessment({ scores: [{ criterion_id: 'c1', score: 4 }] }) },
};

/** Completed — read-only, total shown, Reopen available. */
export const Completed: Story = {
  args: {
    assessment: assessment({
      status: 'COMPLETED',
      total: 9,
      completed_at: '2026-09-30T00:00:00.000Z',
      scores: [
        { criterion_id: 'c1', score: 4 },
        { criterion_id: 'c2', score: 3 },
        { criterion_id: 'c3', score: 2 },
      ],
    }),
  },
};

/** The criteria step alone. Switch the viewport to a phone to see one criterion per screen. */
export const CriteriaStep: StoryObj<typeof CriterionStep> = {
  render: (args) => <CriterionStep {...args} />,
  args: {
    criteria,
    scores: { c1: 4 },
    activeIndex: 1,
    onActiveChange: () => undefined,
    onScore: () => undefined,
    readOnly: false,
  },
};
