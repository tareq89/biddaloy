import type { Meta, StoryObj } from '@storybook/react-vite';

import { Field, FieldGrid } from './field-grid';

const meta: Meta<typeof FieldGrid> = {
  title: 'Components/FieldGrid',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FieldGrid>;

/** Six fields, showing the 1 → 2 → 3 column steps as the viewport widens,
 * capped at `max-w-4xl` so a label is never far from its value. */
export const Default: Story = {
  render: () => (
    <FieldGrid>
      <Field label="Date of birth">12 Jan 2015</Field>
      <Field label="Gender">Male</Field>
      <Field label="Address">45 Green Road, Dhaka</Field>
      <Field label="Preferred communication">SMS</Field>
      <Field label="Guardian">Karim Uddin</Field>
      <Field label="Blood group">B+</Field>
    </FieldGrid>
  ),
};

/** Two fields — proves the grid doesn't force a fixed column count when
 * there's little content. */
export const Narrow: Story = {
  render: () => (
    <FieldGrid>
      <Field label="Issued date">01 Jan 2026</Field>
      <Field label="Due date">31 Jan 2026</Field>
    </FieldGrid>
  ),
};
