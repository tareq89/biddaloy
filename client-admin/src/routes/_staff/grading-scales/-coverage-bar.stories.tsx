import type { BandInput } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { CoverageBar } from './-coverage-bar';

function band(percent_from: number, percent_to: number, sequence: number): BandInput {
  return {
    percent_from,
    percent_to,
    grade: 'X',
    gpa: null,
    is_fail: false,
    sequence,
    comment: null,
  };
}

const meta: Meta<typeof CoverageBar> = {
  component: CoverageBar,
};

export default meta;
type Story = StoryObj<typeof CoverageBar>;

/** No gaps, no overlaps — every point 0-100 claimed exactly once. */
export const Full: Story = {
  args: {
    bands: [band(80, 100, 1), band(50, 79, 2), band(33, 49, 3), band(0, 32, 4)],
  },
};

/** 50-59 belongs to no band — rendered in red. */
export const Gap: Story = {
  args: {
    bands: [band(80, 100, 1), band(60, 79, 2), band(0, 49, 3)],
  },
};

/** 70-79 is claimed by two bands at once — rendered hatched. */
export const Overlap: Story = {
  args: {
    bands: [band(70, 100, 1), band(50, 79, 2), band(0, 49, 3)],
  },
};
