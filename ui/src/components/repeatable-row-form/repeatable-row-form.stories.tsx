import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { RepeatableRowForm, type RepeatableRowField } from './repeatable-row-form';

const fields: RepeatableRowField[] = [
  { key: 'name', label: 'Fee name', type: 'text', required: true },
  { key: 'amount', label: 'Amount', type: 'number', required: true },
];

const meta: Meta<typeof RepeatableRowForm> = {
  title: 'Components/RepeatableRowForm',
  component: RepeatableRowForm,
  tags: ['autodocs'],
  args: {
    fields,
    title: 'Fee structure',
    onSave: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof RepeatableRowForm>;

export const Empty: Story = {
  args: { rows: [] },
};

export const Populated: Story = {
  args: {
    rows: [
      { name: 'Tuition', amount: 1000 },
      { name: 'Library', amount: 200 },
    ],
  },
};

export const AddAndRemoveRow: Story = {
  args: { rows: [{ name: 'Tuition', amount: 1000 }] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Add row' }));
    await expect(canvas.getAllByTestId('repeatable-row')).toHaveLength(2);
    const removeButtons = canvas.getAllByRole('button', { name: 'Remove row' });
    await userEvent.click(removeButtons[1]!);
    await expect(canvas.getAllByTestId('repeatable-row')).toHaveLength(1);
  },
};
