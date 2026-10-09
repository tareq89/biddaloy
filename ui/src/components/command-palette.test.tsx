import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      results: [
        { id: 'a1', label: 'Record payment' },
        { id: 'a2', label: 'Waive fine', disabled: true, description: 'Open a student first' },
      ],
    },
  ],
};

function Controlled({
  tabs = [PEOPLE_TAB, PAGE_TAB, ACTION_TAB],
  onSelect = () => {},
  initialTab,
  footerHint,
}: {
  tabs?: readonly [CommandPaletteTab, ...CommandPaletteTab[]];
  onSelect?: (tabId: CommandPaletteTabId, groupId: string, resultId: string) => void;
  initialTab?: CommandPaletteTabId;
  footerHint?: string;
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
      {...(footerHint !== undefined && { footerHint })}
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

  it('row 1 is active by default and Enter opens it', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, 'ah');
    await screen.findByRole('option', { name: /Ahmed Khan/ });
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0]?.id);

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

    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onSelect).toHaveBeenCalledWith('people', 'guardians', 'g1');
  });

  it('ArrowDown / ArrowUp wrap around', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'ah');
    const options = await screen.findAllByRole('option');

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');

    await user.keyboard('{ArrowUp}');
    expect(options[2]?.getAttribute('aria-selected')).toBe('true');
    expect(options[2]?.textContent).toContain('Karim Khan');
  });

  it('a disabled row is reachable but neither Enter nor click selects it', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSelect={onSelect} initialTab="action" />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    const row = screen.getByRole('option', { name: /Waive fine/ });
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(row.textContent).toContain('Open a student first');

    await user.keyboard('{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(row.id);
    await user.keyboard('{Enter}');
    await user.click(row);

    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'Command palette' })).toBeTruthy();
  });

  it('keeps one fixed-height results area in every state', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const cls = 'h-[min(60dvh,28rem)]';
    expect(screen.getByRole('tabpanel').className).toContain(cls);
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'ah');
    expect(screen.getByRole('tabpanel').className).toContain(cls);
  });

  it('no-results state keeps the fixed height', async () => {
    const user = userEvent.setup();
    render(<Controlled tabs={[{ ...PEOPLE_TAB, groups: [] }, PAGE_TAB]} />);
    await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'zzz');
    expect(screen.getByRole('tabpanel').className).toContain('h-[min(60dvh,28rem)]');
    expect(screen.getByText(/No matches/)).toBeTruthy();
  });

  it('hover moves the highlight only on real mouse movement', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, 'ah');
    const options = await screen.findAllByRole('option');
    const first = options[0]?.id;

    fireEvent.mouseEnter(options[1] as HTMLElement);
    expect(input.getAttribute('aria-activedescendant')).toBe(first);
    fireEvent.mouseMove(options[1] as HTMLElement, { clientX: 5, clientY: 5 });
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id);

    // Same coordinates (synthetic move after a scroll) must not steal the highlight.
    await user.keyboard('{ArrowDown}');
    const moved = input.getAttribute('aria-activedescendant');
    fireEvent.mouseMove(options[0] as HTMLElement, { clientX: 5, clientY: 5 });
    expect(input.getAttribute('aria-activedescendant')).toBe(moved);
  });

  describe('scrollIntoView', () => {
    // jsdom does not implement it, so remove the stub afterwards.
    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it('keyboard moves scroll the row into view', async () => {
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      const user = userEvent.setup();
      render(<Controlled />);
      await user.type(screen.getByRole('combobox', { name: 'Command palette' }), 'ah');
      await screen.findAllByRole('option');
      await user.keyboard('{ArrowDown}');
      expect(scroll).toHaveBeenCalledWith({ block: 'nearest' });
    });
  });

  it('renders the footer hint only when given', () => {
    const { unmount } = render(<Controlled footerHint="↑↓ move" />);
    expect(screen.getByText('↑↓ move')).toBeTruthy();
    unmount();
    render(<Controlled />);
    expect(screen.queryByText('↑↓ move')).toBeNull();
  });

  it('lists the full Page tab on an empty query with row 1 active', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    screen.getByRole('combobox', { name: 'Command palette' }).focus();
    await user.keyboard('{Control>}2{/Control}');
    const option = screen.getByRole('option', { name: /Fee dues/ });
    expect(option.getAttribute('aria-selected')).toBe('true');
  });

  it('Page recents: remembered per tab, People key untouched', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Controlled />);
    screen.getByRole('combobox', { name: 'Command palette' }).focus();
    await user.keyboard('{Control>}2{/Control}{Enter}');
    unmount();

    render(<Controlled />);
    screen.getByRole('combobox', { name: 'Command palette' }).focus();
    await user.keyboard('{Control>}2{/Control}');
    expect(screen.getByText('Recent')).toBeTruthy();
    expect(screen.getAllByRole('option', { name: /Fee dues/ })).toHaveLength(2);
    expect(
      window.localStorage.getItem('command-palette:recent-items:v1:anon:anon:page'),
    ).not.toBeNull();
    // The People hook only ever writes its own (empty) buffer.
    expect(window.localStorage.getItem('command-palette:recent-items:v1:anon:anon') ?? '[]').toBe(
      '[]',
    );
  });

  it('drops a stale Page recent that no longer exists', async () => {
    window.localStorage.setItem(
      'command-palette:recent-items:v1:anon:anon:page',
      JSON.stringify([{ id: 'pages:gone', groupId: 'pages', resultId: 'gone', label: 'Gone' }]),
    );
    const user = userEvent.setup();
    render(<Controlled />);
    screen.getByRole('combobox', { name: 'Command palette' }).focus();
    await user.keyboard('{Control>}2{/Control}');
    expect(screen.queryByText('Recent')).toBeNull();
  });

  it('announces distinct rows, not Recent duplicates', async () => {
    window.localStorage.setItem(
      'command-palette:recent-items:v1:anon:anon:page',
      JSON.stringify([{ id: 'pages:p1', groupId: 'pages', resultId: 'p1', label: 'Fee dues' }]),
    );
    const user = userEvent.setup();
    render(<Controlled />);
    screen.getByRole('combobox', { name: 'Command palette' }).focus();
    await user.keyboard('{Control>}2{/Control}');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('1 result')).toBeTruthy();
  });

  it('keeps a leading "/" in the query when there is no Page tab to jump to', async () => {
    const user = userEvent.setup();
    render(<Controlled tabs={[PEOPLE_TAB]} />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    await user.type(input, '/');
    expect((input as HTMLInputElement).value).toBe('/');
  });

  it('highlights correctly when lower-casing changes the label length', () => {
    const tab: CommandPaletteTab = {
      id: 'page',
      label: 'Page',
      groups: [{ id: 'g', label: 'G', results: [{ id: 'x', label: 'İİ Fee dues' }] }],
    };
    render(<Controlled tabs={[tab]} initialTab="page" />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    fireEvent.change(input, { target: { value: 'fee' } });
    expect(document.querySelector('mark')?.textContent).toBe('Fee');
  });

  it('bolds the matched text', async () => {
    const user = userEvent.setup();
    const { container } = render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Command palette' });
    input.focus();
    await user.keyboard('{Control>}2{/Control}');
    await user.type(input, 'fee');
    expect(container.ownerDocument.querySelector('mark')?.textContent).toBe('Fee');
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

  it('an initialTab missing from tabs selects the first tab, and aria-selected agrees', () => {
    render(<Controlled tabs={[PAGE_TAB, ACTION_TAB]} initialTab="people" />);
    expect(screen.getByRole('tab', { name: 'Page' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Action' }).getAttribute('aria-selected')).toBe('false');
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

    expect(screen.getByText('2 results')).toBeTruthy();
  });
});
