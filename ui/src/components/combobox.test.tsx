import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { Combobox, type ComboboxOption } from './combobox';

const CLASS_OPTIONS: ComboboxOption[] = [
  { value: 'six', label: 'Six' },
  { value: 'seven', label: 'Seven' },
  { value: 'eight', label: 'Eight' },
];

function Controlled() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <Combobox
      aria-label="Class"
      options={CLASS_OPTIONS}
      value={value}
      onValueChange={setValue}
      placeholder="Search…"
    />
  );
}

describe('Combobox', () => {
  it('carries the WAI-ARIA combobox role and wiring on the input', () => {
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Class' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
  });

  it('opens on focus and lists every option with none filtered out', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    expect(await screen.findByRole('option', { name: 'Six' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Seven' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Eight' })).toBeTruthy();
  });

  it('filters options as the query changes', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Class' });
    await user.type(input, 'Se');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Seven' })).toBeTruthy());
    expect(screen.queryByRole('option', { name: 'Six' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Eight' })).toBeNull();
  });

  it('sets aria-activedescendant to the highlighted option as ArrowDown moves through the list', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Class' });
    await user.click(input);
    await screen.findByRole('option', { name: 'Six' });

    await user.keyboard('{ArrowDown}');
    const firstOption = screen.getByRole('option', { name: 'Six' });
    expect(input.getAttribute('aria-activedescendant')).toBe(firstOption.id);

    await user.keyboard('{ArrowDown}');
    const secondOption = screen.getByRole('option', { name: 'Seven' });
    expect(input.getAttribute('aria-activedescendant')).toBe(secondOption.id);
  });

  it('Enter selects the active option, closes the list, and shows the label on the input', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Class' });
    await user.click(input);
    await screen.findByRole('option', { name: 'Six' });
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('false'));
    expect((input as HTMLInputElement).value).toBe('Six');
  });

  it('clicking an option selects it', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Eight' }));
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.value` to typecheck under `tsc --noEmit`.
    expect((screen.getByRole('combobox', { name: 'Class' }) as HTMLInputElement).value).toBe(
      'Eight',
    );
  });

  it('announces a result count that updates as the query filters the list', async () => {
    // The live region lives inside PopoverContent, which Radix renders into
    // a portal appended to document.body — outside RTL's own `container`
    // div — so this searches via `screen` (whole-document) rather than
    // `container.textContent`.
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await screen.findByRole('option', { name: 'Six' });
    expect(screen.getByText('3 results')).toBeTruthy();

    await user.type(screen.getByRole('combobox', { name: 'Class' }), 'Se');
    await waitFor(() => expect(screen.getByText('1 result')).toBeTruthy());
  });

  it('shows empty text and announces zero results when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.type(screen.getByRole('combobox', { name: 'Class' }), 'zzz');
    await waitFor(() => expect(screen.getByText('No results')).toBeTruthy());
  });

  it('ArrowUp moves the active index back up, floored at the first option', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Class' });
    await user.click(input);
    await screen.findByRole('option', { name: 'Six' });
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowUp}');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Six' }).id,
    );
  });

  it('Escape closes the list without selecting anything', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Class' });
    await user.click(input);
    await screen.findByRole('option', { name: 'Six' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(input.getAttribute('aria-expanded')).toBe('false'));
    expect(screen.queryByRole('option', { name: 'Six' })).toBeNull();
  });

  it('still shows the selected label when the input regains focus, rather than going blank', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.value` to typecheck under `tsc --noEmit`.
    const input = screen.getByRole('combobox', { name: 'Class' }) as HTMLInputElement;
    await user.click(input);
    await user.click(await screen.findByRole('option', { name: 'Six' }));
    expect(input.value).toBe('Six');

    await user.click(document.body);
    await user.click(input);
    expect(input.value).toBe('Six');
  });

  it('filtering to a single option after arrowing past it does not leave Enter a no-op (activeIndex re-clamps on every keystroke)', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const input = screen.getByRole('combobox', { name: 'Class' });
    await user.click(input);
    await screen.findByRole('option', { name: 'Six' });
    // Arrow to the 3rd option (index 2) before the list is filtered down.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Eight' }).id,
    );

    // Now filter to a single match — activeIndex must re-clamp to it, not
    // stay stuck at the old index into a now-shorter list.
    await user.type(input, 'Se');
    await waitFor(() => {
      const onlyOption = screen.getByRole('option', { name: 'Seven' });
      expect(input.getAttribute('aria-activedescendant')).toBe(onlyOption.id);
    });
    expect(screen.queryByRole('option', { name: 'Six' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Eight' })).toBeNull();

    await user.keyboard('{Enter}');
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- tsc disagrees with eslint's type resolution here; the cast is required for `.value` to typecheck under `tsc --noEmit`.
    expect((screen.getByRole('combobox', { name: 'Class' }) as HTMLInputElement).value).toBe(
      'Seven',
    );
  });

  it('mounts the live region before the popup ever opens, so the first result count is announced', () => {
    render(<Controlled />);
    // Not scoped to `screen.getByRole('combobox')`'s container — the
    // region lives as a sibling of the popover anchor, always mounted,
    // independent of open state.
    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion?.textContent).toBe('');
  });
});
