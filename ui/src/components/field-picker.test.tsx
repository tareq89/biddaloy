import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FieldPicker } from './field-picker';

const base = {
  locale: 'en' as const,
  groupLabels: { child: 'The child' },
  searchLabel: 'Search fields',
  recommendedLabel: 'Recommended',
  noMatchText: 'No field matches.',
  countLabel: (n: number) => `${n} selected`,
};

describe('FieldPicker', () => {
  it('Tab + Space ticks a field by its accessible name and reports the new keys', async () => {
    const onChange = vi.fn();
    render(<FieldPicker {...base} value={['name']} onChange={onChange} />);
    const user = userEvent.setup();
    const dob = screen.getByRole('checkbox', { name: /Date of birth/i });
    await user.tab(); // search box
    await user.tab(); // first checkbox
    dob.focus();
    await user.keyboard(' ');
    expect(onChange).toHaveBeenCalledWith(['name', 'dob']);
  });

  it('shows the count and the recommended mark', () => {
    render(
      <FieldPicker {...base} value={['name', 'dob']} recommended={['name']} onChange={vi.fn()} />,
    );
    expect(screen.getByRole('status').textContent).toBe('2 selected');
    expect(screen.getAllByText('Recommended')).toHaveLength(1);
  });

  it('search filters by label and says so when nothing matches', async () => {
    render(<FieldPicker {...base} value={[]} onChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search fields' }), 'zzzz');
    expect(screen.getByText('No field matches.')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
