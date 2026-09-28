import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RepeatableRowForm, type RepeatableRowField } from './repeatable-row-form';

const fields: RepeatableRowField[] = [
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'amount', label: 'Amount', type: 'number' },
];

describe('RepeatableRowForm', () => {
  it('renders the empty state with an add-row CTA when there are no rows', () => {
    const onSave = vi.fn();
    render(<RepeatableRowForm fields={fields} rows={[]} onSave={onSave} />);
    expect(screen.getByText('Not filled in yet.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add row' })).toBeTruthy();
    expect(screen.queryByTestId('repeatable-row')).toBeNull();
  });

  it('adds a row from the empty state', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<RepeatableRowForm fields={fields} rows={[]} onSave={onSave} />);
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    expect(screen.getAllByTestId('repeatable-row')).toHaveLength(1);
  });

  it('adds a row from a populated list', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <RepeatableRowForm
        fields={fields}
        rows={[{ name: 'Tuition', amount: 100 }]}
        onSave={onSave}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Add row' }));
    expect(screen.getAllByTestId('repeatable-row')).toHaveLength(2);
  });

  it('removes a row', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <RepeatableRowForm
        fields={fields}
        rows={[
          { name: 'Tuition', amount: 100 },
          { name: 'Books', amount: 50 },
        ]}
        onSave={onSave}
      />,
    );
    const [firstRemoveButton] = screen.getAllByRole('button', { name: 'Remove row' });
    await user.click(firstRemoveButton!);
    expect(screen.getAllByTestId('repeatable-row')).toHaveLength(1);
    expect(screen.getByDisplayValue('Books')).toBeTruthy();
  });

  it('calls onSave with the full replacement array, including an edited field', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <RepeatableRowForm
        fields={fields}
        rows={[{ name: 'Tuition', amount: 100 }]}
        onSave={onSave}
      />,
    );
    const nameInput = screen.getByDisplayValue('Tuition');
    await user.clear(nameInput);
    await user.type(nameInput, 'Term fee');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith([{ name: 'Term fee', amount: 100 }]);
  });

  it('reorders rows with up/down', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <RepeatableRowForm
        fields={fields}
        rows={[
          { name: 'Tuition', amount: 100 },
          { name: 'Books', amount: 50 },
        ]}
        onSave={onSave}
      />,
    );
    const [firstDownButton] = screen.getAllByRole('button', { name: 'Move row down' });
    await user.click(firstDownButton!);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith([
      { name: 'Books', amount: 50 },
      { name: 'Tuition', amount: 100 },
    ]);
  });
});
