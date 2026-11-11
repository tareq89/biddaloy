import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PersonPicker, type PersonPickerItem } from './person-picker';

const items: PersonPickerItem[] = [
  { id: 'a', name: 'Rahim', meta: 'Class 5' },
  { id: 'b', name: 'Karim', meta: 'Class 6', disabledReason: 'No sign-in contact' },
  { id: 'c', name: 'Salma', meta: 'Class 7' },
];
const setup = (over: Partial<React.ComponentProps<typeof PersonPicker>> = {}) => {
  const props = {
    items,
    value: undefined,
    onValueChange: vi.fn(),
    onSearchChange: vi.fn(),
    searchLabel: 'Search',
    emptyLabel: 'Nobody found',
    label: 'People',
    ...over,
  };
  render(<PersonPicker {...props} />);
  return props;
};

describe('PersonPicker', () => {
  it('a disabled row shows its reason and ignores click', () => {
    const p = setup();
    expect(screen.getByText('No sign-in contact')).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Karim/ }));
    expect(p.onValueChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('option', { name: /Rahim/ }));
    expect(p.onValueChange).toHaveBeenCalledWith('a');
  });

  it('keyboard skips disabled rows', () => {
    const p = setup();
    const box = screen.getByRole('combobox', { name: 'Search' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(p.onValueChange).toHaveBeenCalledWith('c');
  });

  it('typing calls onSearchChange and does not filter', () => {
    const p = setup();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } });
    expect(p.onSearchChange).toHaveBeenCalledWith('zzz');
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('shows the empty state', () => {
    setup({ items: [] });
    expect(screen.getByText('Nobody found')).toBeTruthy();
  });

  it('is axe clean', async () => {
    setup({ value: 'a' });
    await expect(document.body).toHaveNoViolations();
  });
});
