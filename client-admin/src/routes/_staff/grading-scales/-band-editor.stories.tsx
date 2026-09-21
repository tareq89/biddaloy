import type { BandInput } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { BandEditor } from './-band-editor';

const STARTER_BANDS: BandInput[] = [
  {
    percent_from: 80,
    percent_to: 100,
    grade: 'A+',
    gpa: 5,
    is_fail: false,
    sequence: 1,
    comment: null,
  },
  {
    percent_from: 33,
    percent_to: 79,
    grade: 'A',
    gpa: 4,
    is_fail: false,
    sequence: 2,
    comment: null,
  },
  {
    percent_from: 0,
    percent_to: 32,
    grade: 'F',
    gpa: 0,
    is_fail: true,
    sequence: 3,
    comment: null,
  },
];

function Controlled({ initial }: { initial: BandInput[] }) {
  const [bands, setBands] = React.useState(initial);
  return <BandEditor bands={bands} onChange={setBands} />;
}

const meta: Meta<typeof BandEditor> = {
  component: BandEditor,
};

export default meta;
type Story = StoryObj<typeof BandEditor>;

/** A populated, contiguous scale. */
export const Populated: Story = {
  render: () => <Controlled initial={STARTER_BANDS} />,
};

/** Empty table — the "Start from BD NCTB" affordance lives on the page,
 * not here; this just shows the bare table + Add band control. */
export const Empty: Story = {
  render: () => <Controlled initial={[]} />,
};

/** Enter on the last row's grade field appends a band continuing from the
 * previous band's `percent_to` — the "type a whole scale in Enters" flow. */
export const EnterAppendsNextBand: Story = {
  render: () => <Controlled initial={STARTER_BANDS.slice(0, 1)} />,
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('storybook/test');
    const canvas = within(canvasElement);
    const gradeInputs = await canvas.findAllByLabelText('Grade');
    await userEvent.click(gradeInputs[gradeInputs.length - 1]!);
    await userEvent.keyboard('{Enter}');
  },
};
