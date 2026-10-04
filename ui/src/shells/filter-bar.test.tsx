import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../test';
import { expectKeyboardOperable, expectTabOrder } from '../test/a11y/keyboard';

import type { FilterFieldDescriptor } from './filter-bar';
import { FilterBar } from './filter-bar';

const FIELDS: FilterFieldDescriptor[] = [
  { kind: 'text', key: 'search', label: 'Search', placeholder: 'Search by name…', primary: true },
  {
    kind: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'All statuses',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
  },
  {
    kind: 'date-range',
    fromKey: 'from_date',
    toKey: 'to_date',
    label: 'Date range',
    fromLabel: 'From date',
    toLabel: 'To date',
  },
  { kind: 'checkbox', key: 'flagged', label: 'Flagged' },
  {
    kind: 'number-range',
    minKey: 'min_amount',
    maxKey: 'max_amount',
    label: 'Amount',
    minLabel: 'Min amount',
    maxLabel: 'Max amount',
  },
];

function FilterBarDemo({
  initialValues = {},
  onChangeSpy,
}: {
  initialValues?: Record<string, string>;
  onChangeSpy?: (patch: Record<string, string | null>) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  return (
    <FilterBar
      fields={FIELDS}
      values={values}
      onChange={(patch) => {
        onChangeSpy?.(patch);
        setValues((current) => {
          const next = { ...current };
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) delete next[key];
            else next[key] = value;
          }
          return next;
        });
      }}
    />
  );
}

/** `DEFAULT_LOCALE` (`locale-storage.ts`) is Bengali, not English — same
 * reason `cached-data-notice.test.tsx` forces `locale: 'en'` and awaits
 * `localeReady` before any synchronous assertion, rather than relying on
 * whatever the shared i18next instance happens to default to. */
async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
  });
  return view;
}

describe('FilterBar', () => {
  it('renders one control per descriptor kind, each with an accessible name', async () => {
    await renderInEnglish(<FilterBarDemo />);

    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'From date' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'To date' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Flagged' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Min amount' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Max amount' })).toBeTruthy();
  });

  it('is axe clean with no active filters', async () => {
    const { container } = await renderInEnglish(<FilterBarDemo />);
    await expect(container).toHaveNoViolations();
  });

  it('is axe clean with the mobile panel expanded and chips showing', async () => {
    const user = userEvent.setup();
    const { container } = await renderInEnglish(
      <FilterBarDemo initialValues={{ status: 'active' }} />,
    );
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await expect(container).toHaveNoViolations();
  });

  it('committing text input calls onChange with the typed value, after the debounce settles', async () => {
    const onChangeSpy = vi.fn();
    await renderInEnglish(<FilterBarDemo onChangeSpy={onChangeSpy} />);

    // `fireEvent.change` (one synchronous update), not `userEvent.type`
    // (real per-character delay racing the 300ms debounce's own timer) —
    // the debounce timing itself is `use-filter-bar-state.test.tsx`'s job;
    // this only proves `FilterBar`'s `Input` is wired to `setLocalValue`.
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'rahim' },
    });
    expect(onChangeSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(onChangeSpy).toHaveBeenLastCalledWith({ search: 'rahim' }));
  });

  it('selecting the "all" option clears the filter by committing null, not the sentinel', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    await renderInEnglish(
      <FilterBarDemo initialValues={{ status: 'active' }} onChangeSpy={onChangeSpy} />,
    );

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'All statuses' }));

    expect(onChangeSpy).toHaveBeenCalledWith({ status: null });
  });

  it('selecting a real option commits its value, not the sentinel', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    await renderInEnglish(<FilterBarDemo onChangeSpy={onChangeSpy} />);

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Active' }));

    expect(onChangeSpy).toHaveBeenCalledWith({ status: 'active' });
  });

  it('a select value not in `options` (a stale bookmark, a renamed status) still shows something instead of a blank trigger', async () => {
    await renderInEnglish(<FilterBarDemo initialValues={{ status: 'archived' }} />);

    const trigger = screen.getByRole('combobox', { name: 'Status' });
    expect(trigger.textContent).not.toBe('');
    expect(trigger.textContent).toContain('archived');
  });

  it('checking the checkbox commits "true"; unchecking commits null', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    await renderInEnglish(<FilterBarDemo onChangeSpy={onChangeSpy} />);

    const checkbox = screen.getByRole('checkbox', { name: 'Flagged' });
    await user.click(checkbox);
    expect(onChangeSpy).toHaveBeenLastCalledWith({ flagged: 'true' });

    await user.click(checkbox);
    expect(onChangeSpy).toHaveBeenLastCalledWith({ flagged: null });
  });

  // [31.2.2] the date fields are DatePicker buttons now: pick the 15th of the
  // month the calendar opens on instead of typing into a text input.
  const pickedIso = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
  };

  it('picking a date commits ASCII YYYY-MM-DD, even though the default region config is bn', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    await renderInEnglish(<FilterBarDemo onChangeSpy={onChangeSpy} />);

    await user.click(screen.getByRole('button', { name: 'From date' }));
    await user.click(document.querySelector<HTMLElement>(`[data-date="${pickedIso()}"]`)!);

    expect(onChangeSpy).toHaveBeenLastCalledWith({ from_date: pickedIso() });
  });

  it('picking the second date of a range commits its own key independently', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    await renderInEnglish(<FilterBarDemo onChangeSpy={onChangeSpy} />);

    await user.click(screen.getByRole('button', { name: 'To date' }));
    await user.click(document.querySelector<HTMLElement>(`[data-date="${pickedIso()}"]`)!);

    expect(onChangeSpy).toHaveBeenLastCalledWith({ to_date: pickedIso() });
  });

  it('committing min/max number-range inputs calls onChange with each key independently', async () => {
    const onChangeSpy = vi.fn();
    await renderInEnglish(<FilterBarDemo onChangeSpy={onChangeSpy} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Min amount' }), {
      target: { value: '100' },
    });
    await waitFor(() => expect(onChangeSpy).toHaveBeenLastCalledWith({ min_amount: '100' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Max amount' }), {
      target: { value: '500' },
    });
    await waitFor(() => expect(onChangeSpy).toHaveBeenLastCalledWith({ max_amount: '500' }));
  });

  it('shows the mobile disclosure trigger with an accurate active-filter count', async () => {
    await renderInEnglish(<FilterBarDemo initialValues={{ status: 'active', flagged: 'true' }} />);
    const trigger = screen.getByRole('button', { name: 'Filters (2)' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBeTruthy();
  });

  it('shows "Filters" with no count when nothing is active, and flips to "Hide filters" when expanded', async () => {
    const user = userEvent.setup();
    await renderInEnglish(<FilterBarDemo />);
    const trigger = screen.getByRole('button', { name: 'Filters' });

    await user.click(trigger);
    expect(screen.getByRole('button', { name: 'Hide filters' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide filters' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('the disclosure trigger aria-controls points at the collapsible panel id', async () => {
    await renderInEnglish(<FilterBarDemo />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    const panelId = trigger.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).toBeTruthy();
  });

  it('the mobile disclosure trigger is keyboard-operable (Tab-reachable, Enter/Space activate it)', async () => {
    await renderInEnglish(<FilterBarDemo />);
    const trigger = screen.getByRole('button', { name: 'Filters' });
    await expectKeyboardOperable(trigger);
  });

  it('Tab visits every control in descriptor order — primary field, disclosure trigger, then each collapsible control', async () => {
    await renderInEnglish(<FilterBarDemo />);

    // [31.2.2] each date is one DatePicker button (no separate calendar icon).
    const user = userEvent.setup();
    await expectTabOrder(
      [
        screen.getByRole('textbox', { name: 'Search' }),
        screen.getByRole('button', { name: 'Filters' }),
        screen.getByRole('combobox', { name: 'Status' }),
        screen.getByRole('button', { name: 'From date' }),
        screen.getByRole('button', { name: 'To date' }),
        screen.getByRole('checkbox', { name: 'Flagged' }),
        screen.getByRole('textbox', { name: 'Min amount' }),
        screen.getByRole('textbox', { name: 'Max amount' }),
      ],
      { user },
    );
  });

  it('renders a chip for a `values` key no descriptor covers, and it can still be cleared (deep-link regression)', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    await renderInEnglish(
      <FilterBarDemo initialValues={{ student_id: 'stu-1' }} onChangeSpy={onChangeSpy} />,
    );

    expect(screen.getByText('student_id: stu-1')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Remove filter: student_id: stu-1' }));
    expect(onChangeSpy).toHaveBeenCalledWith({ student_id: null });
  });

  it('gives each chip remove button a distinct accessible name', async () => {
    await renderInEnglish(<FilterBarDemo initialValues={{ status: 'active', flagged: 'true' }} />);

    expect(screen.getByRole('button', { name: 'Remove filter: Status: Active' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove filter: Flagged' })).toBeTruthy();
  });

  it('clearAll clears every active key, descriptor-covered or not', async () => {
    const user = userEvent.setup();
    const onChangeSpy = vi.fn();
    await renderInEnglish(
      <FilterBarDemo
        initialValues={{ status: 'active', student_id: 'stu-1' }}
        onChangeSpy={onChangeSpy}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(onChangeSpy).toHaveBeenCalledWith({ status: null, student_id: null });
  });

  it('renders no chip row and no "Clear all" when nothing is active', async () => {
    await renderInEnglish(<FilterBarDemo />);
    expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('shows a malformed date value as an empty field instead of crashing', async () => {
    await renderInEnglish(<FilterBarDemo initialValues={{ from_date: 'not-a-date' }} />);

    expect(screen.getByRole('button', { name: 'From date' }).textContent).toContain('Pick a date');
  });

  it('warns in dev when more than one field declares `primary: true`, without crashing', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fieldsWithTwoPrimaries: FilterFieldDescriptor[] = [
      { kind: 'text', key: 'a', label: 'A', primary: true },
      { kind: 'text', key: 'b', label: 'B', primary: true },
    ];
    await renderInEnglish(
      <FilterBar fields={fieldsWithTwoPrimaries} values={{}} onChange={vi.fn()} />,
    );

    expect(screen.getByRole('textbox', { name: 'A' })).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('more than one field'));
    warnSpy.mockRestore();
  });
});
