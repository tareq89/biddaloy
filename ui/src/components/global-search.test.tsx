import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { GlobalSearch, type GlobalSearchGroup } from './global-search';

const GROUPS: GlobalSearchGroup[] = [
  {
    id: 'students',
    label: 'Students',
    results: [
      { id: 's1', label: 'Ahmed Khan', description: 'Roll 7' },
      { id: 's2', label: 'Fatima Begum', description: 'Roll 8' },
    ],
  },
  {
    id: 'guardians',
    label: 'Guardians',
    results: [{ id: 'g1', label: 'Karim Khan', description: 'Father' }],
  },
];

function Controlled({
  groups = GROUPS,
  onSelect = () => {},
}: {
  groups?: GlobalSearchGroup[];
  onSelect?: (groupId: string, resultId: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  return (
    <GlobalSearch
      aria-label="Global search"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      groups={query.trim() === '' ? [] : groups}
      onSelect={onSelect}
    />
  );
}

describe('GlobalSearch', () => {
  it('carries the WAI-ARIA combobox role and wiring on the input', () => {
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Global search' });
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('shows the searchable hint before anything is typed', () => {
    render(<Controlled />);
    expect(screen.getByText(/search by student name/i)).toBeTruthy();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('groups results by entity type as the query changes', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Global search' }), 'ah');

    expect(await screen.findByRole('option', { name: /Ahmed Khan/ })).toBeTruthy();
    expect(screen.getByText('Students')).toBeTruthy();
    expect(screen.getByText('Guardians')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Karim Khan/ })).toBeTruthy();
  });

  it('shows a distinct no-results message once a query matches nothing', async () => {
    const user = userEvent.setup();
    render(<Controlled groups={[]} />);
    await user.type(screen.getByRole('combobox', { name: 'Global search' }), 'zzz');
    await waitFor(() => expect(screen.getByText(/No matches for "zzz"/)).toBeTruthy());
  });

  it('typing then Enter selects the first result (already active by default) and closes', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Global search' });
    await user.type(input, 'ah');
    const firstOption = await screen.findByRole('option', { name: /Ahmed Khan/ });
    expect(input.getAttribute('aria-activedescendant')).toBe(firstOption.id);

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('students', 's1');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('ArrowDown moves the active option to the next result across group boundaries', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Global search' });
    await user.type(input, 'ah');
    await screen.findByRole('option', { name: /Ahmed Khan/ });

    // students[0], students[1], guardians[0] — three ArrowDowns from the
    // default index-0 position lands on the guardian.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith('guardians', 'g1');
  });

  it('clicking a result selects it', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} />);
    await user.type(screen.getByRole('combobox', { name: 'Global search' }), 'ah');
    await user.click(await screen.findByRole('option', { name: /Karim Khan/ }));

    expect(onSelect).toHaveBeenCalledWith('guardians', 'g1');
  });

  it('announces the result count through a polite live region', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Global search' }), 'ah');
    await screen.findByRole('option', { name: /Ahmed Khan/ });
    expect(screen.getByText('3 results')).toBeTruthy();
  });
});
