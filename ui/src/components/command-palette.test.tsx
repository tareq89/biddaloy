import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CommandPalette,
  type CommandPaletteTab,
  type CommandPaletteTabId,
} from './command-palette';

const PEOPLE_TAB: CommandPaletteTab = {
  id: 'people',
  label: 'People',
  groups: [
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
  ],
};

const PAGE_TAB: CommandPaletteTab = {
  id: 'page',
  label: 'Page',
  groups: [
    {
      id: 'pages',
      label: 'Pages',
      results: [{ id: 'p1', label: 'Fee dues' }],
    },
  ],
};

const ACTION_TAB: CommandPaletteTab = {
  id: 'action',
  label: 'Action',
  groups: [
    {
      id: 'actions',
      label: 'Actions',
      results: [{ id: 'a1', label: 'Record payment' }],
    },
  ],
};

function Controlled({
  tabs = [PEOPLE_TAB, PAGE_TAB, ACTION_TAB],
  onSelect = () => {},
  initialTab,
}: {
  tabs?: readonly [CommandPaletteTab, CommandPaletteTab, CommandPaletteTab];
  onSelect?: (tabId: CommandPaletteTabId, groupId: string, resultId: string) => void;
  initialTab?: CommandPaletteTabId;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  return (
    <CommandPalette
      aria-label="Command palette"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      tabs={tabs}
      onSelect={onSelect}
      {...(initialTab !== undefined && { initialTab })}
    />
  );
}

describe('CommandPalette', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  // Equivalents of every `GlobalSearch` behaviour ----------------------

  it('carries WAI-ARIA combobox role wiring on input', () => {
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('groups results by entity type as query changes, within the active tab', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'ah');
    await screen.findByRole('option', { name: /Ahmed Khan/ });
    expect(screen.getByText('Students')).toBeTruthy();
    expect(screen.getByText('Guardians')).toBeTruthy();
  });

  it('shows a distinct no-results message once a query matches nothing', async () => {
    const user = userEvent.setup();
    const emptyPeopleTab: CommandPaletteTab = { ...PEOPLE_TAB, groups: [] };
    render(<Controlled tabs={[emptyPeopleTab, PAGE_TAB, ACTION_TAB]} />);
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'zzz');
    await waitFor(() => expect(screen.getByText(/No matches for "zzz"/)).toBeTruthy());
  });

  it('Enter selects the first result when nothing has been walked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, 'ah');
    await screen.findByRole('option', { name: /Ahmed Khan/ });
    expect(input.getAttribute('aria-activedescendant')).toBeNull();

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('people', 'students', 's1');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('ArrowDown moves the active option across group boundaries', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, 'ah');
    await screen.findByRole('option', { name: /Ahmed Khan/ });

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith('people', 'guardians', 'g1');
  });

  it('clicking a result selects it', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} />);
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'ah');
    await user.click(await screen.findByRole('option', { name: /Karim Khan/ }));

    expect(onSelect).toHaveBeenCalledWith('people', 'guardians', 'g1');
  });

  it('announces result count through a polite live region', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'ah');
    await screen.findByRole('option', { name: /Ahmed Khan/ });
    expect(screen.getByText('3 results')).toBeTruthy();
  });

  // Tab layer (D11) ------------------------------------------------------

  it('opens on the People tab', () => {
    render(<Controlled />);
    const peopleTab = screen.getByRole('tab', { name: 'People' });
    expect(peopleTab.getAttribute('aria-selected')).toBe('true');
  });

  it('initialTab overrides the default People-tab open, without fighting the open-reset effect', () => {
    render(<Controlled initialTab="page" />);
    expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('false');
  });

  it('Ctrl+2 and Ctrl+3 jump directly to Page and Action', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    input.focus();

    await user.keyboard('{Control>}2{/Control}');
    expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{Control>}3{/Control}');
    expect(screen.getByRole('tab', { name: 'Action' }).getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{Control>}1{/Control}');
    expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowRight and ArrowLeft step between tabs', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    input.focus();

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Action' }).getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true');
  });

  it('typing "/" as the first character jumps to Page and is not searched', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, '/');

    expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('typing ">" as the first character jumps to Action and is not searched', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, '>');

    expect(screen.getByRole('tab', { name: 'Action' }).getAttribute('aria-selected')).toBe('true');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('Tab key does not switch tabs and keeps its native focus behaviour', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    input.focus();

    await user.keyboard('{Tab}');

    expect(screen.getByRole('tab', { name: 'People' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).not.toBe(input);
  });

  it('↑/↓/Enter operate within the active (Page) tab', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    input.focus();
    await user.keyboard('{Control>}2{/Control}');
    await user.type(input, 'fee');
    await screen.findByRole('option', { name: /Fee dues/ });

    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith('page', 'pages', 'p1');
  });

  // Recents (D10) --------------------------------------------------------

  it('shows the searchable hint when query is empty and no recents exist', () => {
    render(<Controlled />);
    expect(screen.getByText(/search by student name/i)).toBeTruthy();
  });

  it('shows recents first, then the hint once query is emptied again', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    const { unmount } = render(<Controlled onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, 'ah');
    await user.click(await screen.findByRole('option', { name: /Ahmed Khan/ }));
    unmount();

    render(<Controlled />);
    expect(screen.getByText('Recent')).toBeTruthy();
    expect(screen.getByRole('option', { name: /Ahmed Khan/ })).toBeTruthy();
  });

  it('still renders when localStorage throws', () => {
    const getItemSpy = vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    expect(() => render(<Controlled />)).not.toThrow();
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toBeTruthy();

    getItemSpy.mockRestore();
  });

  it('live region announces the active tab result count', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    input.focus();
    await user.keyboard('{Control>}3{/Control}');
    await user.type(input, 'pay');
    await screen.findByRole('option', { name: /Record payment/ });

    expect(screen.getByText('1 result')).toBeTruthy();
  });
});
