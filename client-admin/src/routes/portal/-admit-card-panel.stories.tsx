import type { Meta, StoryObj } from '@storybook/react-vite';

import { AdmitCardPanel } from './-admit-card-panel';

/** The three admit-card panel states, in Bangla. No data hooks: the route test covers the wiring. */
const meta: Meta<typeof AdmitCardPanel> = {
  component: AdmitCardPanel,
  globals: { locale: 'bn' },
  args: {
    studentName: 'সাকিব সুলতান',
    onPrint: () => {},
    feesHref: '/portal/fees?student=student-2',
  },
};
export default meta;

type Story = StoryObj<typeof AdmitCardPanel>;

export const Ready: Story = { args: { state: 'ready' } };

export const Withheld: Story = {
  args: { state: 'withheld', amount: '৳২,৮০০.০০', officePhone: '০১৭১১-২২৩৩৪৪' },
};

export const NotReady: Story = { args: { state: 'not-ready' } };
