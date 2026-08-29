import type { ColumnVisibilityState } from '@tanstack/react-table';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableColumn, type DataTableSort } from './data-table';

interface Student {
  id: string;
  name: string;
  className: string;
}

const STUDENTS: Student[] = [
  { id: '1', name: 'Rahim Uddin', className: 'Six' },
  { id: '2', name: 'Karim Ahmed', className: 'Seven' },
  { id: '3', name: 'Fatema Begum', className: 'Six' },
];

const COLUMNS: DataTableColumn<Student>[] = [
  { id: 'name', header: 'Name', accessorFn: (row) => row.name, sortable: true },
  { id: 'className', header: 'Class', accessorFn: (row) => row.className },
];

function Controlled({
  data = STUDENTS,
  totalCount = STUDENTS.length,
  loading = false,
  error,
  selectable = false,
  emptyMessage,
  columnsMenu = false,
  defaultColumnVisibility,
  columns = COLUMNS,
  expandable = false,
}: {
  data?: Student[];
  totalCount?: number;
  loading?: boolean;
  error?: string;
  selectable?: boolean;
  emptyMessage?: string;
  columnsMenu?: boolean;
  defaultColumnVisibility?: ColumnVisibilityState;
  columns?: DataTableColumn<Student>[];
  expandable?: boolean;
}) {
  const [sorting, setSorting] = useState<DataTableSort | null>(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  return (
    <DataTable
      tableId="students-test"
      caption="Students"
      columns={columns}
      data={data}
      getRowId={(row) => row.id}
      sorting={sorting}
      onSortingChange={setSorting}
      page={page}
      pageSize={20}
      totalCount={totalCount}
      onPageChange={setPage}
      loading={loading}
      columnsMenu={columnsMenu}
      {...(defaultColumnVisibility !== undefined ? { defaultColumnVisibility } : {})}
      {...(error !== undefined ? { error } : {})}
      {...(emptyMessage !== undefined ? { emptyMessage } : {})}
      {...(selectable
        ? {
            selectedIds,
            onSelectedIdsChange: setSelectedIds,
            bulkActions: <button type="button">Delete selected</button>,
          }
        : {})}
      {...(expandable
        ? {
            expandRowLabel: (row: Student) => `Details for ${row.name}`,
            renderExpandedRow: (row: Student) => <p>Expanded details for {row.name}</p>,
          }
        : {})}
    />
  );
}

/** Page two of the same server-paginated list — `manualPagination` means
 * `data` only ever holds one page, which is exactly what makes the header
 * "select all" checkbox page-scoped. */
const STUDENTS_PAGE_2: Student[] = [
  { id: '4', name: 'Nadia Islam', className: 'Eight' },
  { id: '5', name: 'Sabbir Hossain', className: 'Eight' },
  { id: '6', name: 'Tania Akter', className: 'Nine' },
];

function PagedControlled() {
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  return (
    <DataTable
      tableId="students-paged-test"
      caption="Students"
      columns={COLUMNS}
      data={page === 1 ? STUDENTS : STUDENTS_PAGE_2}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => undefined}
      page={page}
      pageSize={3}
      totalCount={6}
      onPageChange={setPage}
      selectedIds={selectedIds}
      onSelectedIdsChange={setSelectedIds}
      bulkActions={<button type="button">Delete selected</button>}
    />
  );
}

describe('DataTable', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders a real <table> with a <caption> and <th scope="col">', () => {
    render(<Controlled />);
    const table = screen.getByRole('table');
    expect(table.tagName).toBe('TABLE');
    // The caption is visually hidden but present for the accessible name.
    expect(screen.getByText('Students', { selector: 'caption' })).toBeTruthy();
    for (const header of ['Name', 'Class']) {
      const th = screen.getByRole('columnheader', { name: header });
      expect(th.tagName).toBe('TH');
      expect(th.getAttribute('scope')).toBe('col');
    }
  });

  it('renders every row and cell from data', () => {
    render(<Controlled />);
    expect(screen.getByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Karim Ahmed')).toBeTruthy();
    expect(screen.getByText('Fatema Begum')).toBeTruthy();
  });

  it('sets aria-sort on a sortable column header, cycling on click, and reports it via onSortingChange', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const nameHeader = screen.getByRole('columnheader', { name: /Name/ });
    expect(nameHeader.getAttribute('aria-sort')).toBe('none');

    await user.click(screen.getByRole('button', { name: /Name/ }));
    await waitFor(() => expect(nameHeader.getAttribute('aria-sort')).toBe('ascending'));

    await user.click(screen.getByRole('button', { name: /Name/ }));
    await waitFor(() => expect(nameHeader.getAttribute('aria-sort')).toBe('descending'));
  });

  it('a non-sortable column header carries no aria-sort at all', () => {
    render(<Controlled />);
    expect(screen.getByRole('columnheader', { name: 'Class' }).hasAttribute('aria-sort')).toBe(
      false,
    );
  });

  it('shows a loading state as a first-class prop, not real rows', () => {
    render(<Controlled loading />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('Rahim Uddin')).toBeNull();
  });

  it('shows an empty state with a caller-provided message', () => {
    render(<Controlled data={[]} totalCount={0} emptyMessage="No students yet" />);
    expect(screen.getByText('No students yet')).toBeTruthy();
  });

  it('shows an error state via role=alert rather than rendering stale rows', () => {
    render(<Controlled data={[]} error="Failed to load students" />);
    expect(screen.getByRole('alert').textContent).toBe('Failed to load students');
  });

  it('announces the result count politely on render', () => {
    render(<Controlled totalCount={30} />);
    expect(screen.getByText('3 of 30 results')).toBeTruthy();
  });

  it('the scroll container is a focusable, labelled region — the 320px responsive strategy', () => {
    render(<Controlled />);
    const region = screen.getByRole('region', { name: 'Students' });
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('arrow keys move cell focus via roving tabindex', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const cells = screen.getAllByRole('cell');
    // Only one cell (the first) is a tab stop initially.
    expect(cells[0]?.getAttribute('tabindex')).toBe('0');
    expect(cells[1]?.getAttribute('tabindex')).toBe('-1');

    cells[0]?.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(document.activeElement).toBe(cells[1]));

    await user.keyboard('{ArrowDown}');
    // Two columns per row, so moving down one row lands two cells later.
    await waitFor(() => expect(document.activeElement).toBe(cells[3]));

    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(document.activeElement).toBe(cells[1]));

    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(document.activeElement).toBe(cells[0]));
  });

  it('Home/End move focus to the first/last cell in the current row', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const cells = screen.getAllByRole('cell');
    cells[0]?.focus();

    await user.keyboard('{End}');
    await waitFor(() => expect(document.activeElement).toBe(cells[1]));

    await user.keyboard('{Home}');
    await waitFor(() => expect(document.activeElement).toBe(cells[0]));
  });

  it('arrow keys cannot move focus past the edges of the grid', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const cells = screen.getAllByRole('cell');
    cells[0]?.focus();
    await user.keyboard('{ArrowUp}{ArrowLeft}');
    await waitFor(() => expect(document.activeElement).toBe(cells[0]));
  });

  it('Space toggles row selection when a cell in that row is focused, and toggles it back off', async () => {
    const user = userEvent.setup();
    render(<Controlled selectable />);
    // The checkbox column's <td> isn't part of the roving-tabindex grid
    // (the checkbox itself is its own native tab stop) — the first *data*
    // cell (index 1, after the checkbox cell at index 0) is the roving stop.
    const cells = screen.getAllByRole('cell');
    cells[1]?.focus();
    await user.keyboard(' ');
    const checkboxes = screen.getAllByRole('checkbox', { name: /Select row/ });
    await waitFor(() => expect(checkboxes[0]?.getAttribute('aria-checked')).toBe('true'));

    await user.keyboard(' ');
    await waitFor(() => expect(checkboxes[0]?.getAttribute('aria-checked')).toBe('false'));
  });

  it('Space on a cell does nothing when the table is not selectable', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    const cells = screen.getAllByRole('cell');
    cells[0]?.focus();
    await user.keyboard(' ');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('exposes selection state and bulk actions to the shell only once something is selected', async () => {
    const user = userEvent.setup();
    render(<Controlled selectable />);
    expect(screen.queryByRole('button', { name: 'Delete selected' })).toBeNull();

    await user.click(screen.getAllByRole('checkbox', { name: /Select row/ })[0]!);
    expect(await screen.findByRole('button', { name: 'Delete selected' })).toBeTruthy();
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('selecting all rows via the header checkbox selects every row on the page', async () => {
    const user = userEvent.setup();
    render(<Controlled selectable />);
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    for (const checkbox of screen.getAllByRole('checkbox', { name: /Select row/ })) {
      expect(checkbox.getAttribute('aria-checked')).toBe('true');
    }
  });

  // Business-critical for `bulk-reminder-wizard.tsx`: the selection is the
  // literal list of students who get an SMS, so a header checkbox that
  // *replaced* the selection instead of adding to it silently dropped
  // everyone picked on an earlier page.
  it('select-all on page two keeps rows already selected on page one', async () => {
    const user = userEvent.setup();
    render(<PagedControlled />);

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
    expect(screen.getByText('1 selected')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Nadia Islam');
    // Page two starts unselected, so the header checkbox reads unchecked
    // even though the overall selection is non-empty.
    const selectAll = screen.getByRole('checkbox', { name: 'Select all rows on this page' });
    expect(selectAll.getAttribute('aria-checked')).toBe('false');

    await user.click(selectAll);
    // 1 from page one + 3 from page two — not 3.
    expect(screen.getByText('4 selected')).toBeTruthy();
  });

  it('clearing select-all on page two leaves page one selections alone', async () => {
    const user = userEvent.setup();
    render(<PagedControlled />);

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Nadia Islam');
    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    expect(screen.getByText('6 selected')).toBeTruthy();

    await user.click(screen.getByRole('checkbox', { name: 'Select all rows on this page' }));
    // Only page two was cleared.
    expect(screen.getByText('3 selected')).toBeTruthy();
  });

  it('shows the header checkbox as indeterminate when only some page rows are selected', async () => {
    const user = userEvent.setup();
    render(<Controlled selectable />);
    await user.click(screen.getAllByRole('checkbox', { name: /Select row/ })[0]!);
    expect(
      screen
        .getByRole('checkbox', { name: 'Select all rows on this page' })
        .getAttribute('aria-checked'),
    ).toBe('mixed');
  });

  it('persists column visibility to localStorage per tableId', () => {
    const setItem = vi.spyOn(window.localStorage.__proto__, 'setItem');
    render(<Controlled />);
    expect(setItem).toHaveBeenCalledWith('data-table:students-test', expect.any(String));
    setItem.mockRestore();
  });

  it('does not crash on a corrupt localStorage value for this tableId', () => {
    window.localStorage.setItem('data-table:students-test', 'not json');
    expect(() => render(<Controlled />)).not.toThrow();
  });
});

describe('DataTable columns menu', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('renders no Columns trigger when columnsMenu is off — the default', () => {
    render(<Controlled />);
    expect(screen.queryByRole('button', { name: 'Columns' })).toBeNull();
  });

  it('lists every column as a checked item, all columns visible by default', async () => {
    const user = userEvent.setup();
    render(<Controlled columnsMenu />);

    await user.click(screen.getByRole('button', { name: 'Columns' }));

    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Name' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Class' }).getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('unchecking a column hides it from the table header and its cells', async () => {
    const user = userEvent.setup();
    render(<Controlled columnsMenu />);

    expect(screen.getByRole('columnheader', { name: 'Class' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Class' }));

    expect(screen.queryByRole('columnheader', { name: 'Class' })).toBeNull();
    expect(screen.queryByText('Six')).toBeNull();
  });

  it('respects defaultColumnVisibility on first mount, before any localStorage value exists', () => {
    render(<Controlled columnsMenu defaultColumnVisibility={{ className: false }} />);
    expect(screen.queryByRole('columnheader', { name: 'Class' })).toBeNull();
  });

  it('a persisted localStorage choice wins over defaultColumnVisibility on remount', () => {
    window.localStorage.setItem(
      'data-table:students-test',
      JSON.stringify({ columnVisibility: { className: true }, columnOrder: [] }),
    );
    render(<Controlled columnsMenu defaultColumnVisibility={{ className: false }} />);
    expect(screen.getByRole('columnheader', { name: 'Class' })).toBeTruthy();
  });
});

describe('DataTable pinned columns', () => {
  const PINNED_COLUMNS: DataTableColumn<Student>[] = [
    { id: 'name', header: 'Name', accessorFn: (row) => row.name, sortable: true },
    { id: 'className', header: 'Class', accessorFn: (row) => row.className, pinned: true },
  ];

  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it('stays visible even when defaultColumnVisibility names it hidden', () => {
    render(<Controlled columns={PINNED_COLUMNS} defaultColumnVisibility={{ className: false }} />);
    expect(screen.getByRole('columnheader', { name: 'Class' })).toBeTruthy();
  });

  it('stays visible even when a stale localStorage value names it hidden', () => {
    window.localStorage.setItem(
      'data-table:students-test',
      JSON.stringify({ columnVisibility: { className: false }, columnOrder: [] }),
    );
    render(<Controlled columns={PINNED_COLUMNS} />);
    expect(screen.getByRole('columnheader', { name: 'Class' })).toBeTruthy();
  });

  it('is omitted from the columns menu, so it cannot be toggled off', async () => {
    const user = userEvent.setup();
    render(<Controlled columns={PINNED_COLUMNS} columnsMenu />);

    expect(screen.getByRole('columnheader', { name: 'Class' })).toBeTruthy();

    // Radix marks the rest of the page aria-hidden while the menu is open,
    // so the columnheader check above has to happen before this point.
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Class' })).toBeNull();
  });
});

describe('DataTable pagination', () => {
  afterEach(() => window.localStorage.clear());

  it('Previous is disabled on the first page, Next is not', () => {
    render(<Controlled totalCount={100} />);
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(false);
  });

  it('clicking Next calls onPageChange with the next page', async () => {
    const user = userEvent.setup();
    function PageProbe() {
      const [page, setPage] = useState(1);
      const [sorting, setSorting] = useState<DataTableSort | null>(null);
      return (
        <DataTable
          tableId="students-page-test"
          caption="Students"
          columns={COLUMNS}
          data={STUDENTS}
          getRowId={(row) => row.id}
          sorting={sorting}
          onSortingChange={setSorting}
          page={page}
          pageSize={2}
          totalCount={10}
          onPageChange={setPage}
        />
      );
    }
    render(<PageProbe />);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('Page 2 of 5')).toBeTruthy());
  });
});

describe('DataTable expandable rows', () => {
  afterEach(() => window.localStorage.clear());

  it('is absent when renderExpandedRow is not supplied', () => {
    render(<Controlled />);
    expect(screen.queryAllByRole('button', { name: /Details for/ })).toHaveLength(0);
  });

  it('renders a per-row toggle, collapsed by default, that expands and collapses on click', async () => {
    const user = userEvent.setup();
    render(<Controlled expandable />);

    const toggle = screen.getByRole('button', { name: 'Details for Rahim Uddin' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Expanded details for Rahim Uddin')).toBeNull();
    // Not set while collapsed — the `<tr>` it would name doesn't exist in
    // the DOM yet, so `aria-controls` mustn't point at a nonexistent id.
    expect(toggle.getAttribute('aria-controls')).toBeNull();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Expanded details for Rahim Uddin')).toBeTruthy();

    // `aria-controls` must actually resolve to the panel it names.
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId as string)?.textContent).toContain(
      'Expanded details for Rahim Uddin',
    );

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Expanded details for Rahim Uddin')).toBeNull();
    // Removed again on re-collapse, same reasoning as the initial state.
    expect(toggle.getAttribute('aria-controls')).toBeNull();
  });

  it("expanding one row does not affect another row's expanded state", async () => {
    const user = userEvent.setup();
    render(<Controlled expandable />);

    await user.click(screen.getByRole('button', { name: 'Details for Rahim Uddin' }));
    expect(screen.getByText('Expanded details for Rahim Uddin')).toBeTruthy();
    expect(screen.queryByText('Expanded details for Karim Ahmed')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Details for Karim Ahmed' }));
    // Both stay expanded — the AC only requires each row's toggle to be
    // independently keyboard-operable, not an accordion (single-open) group.
    expect(screen.getByText('Expanded details for Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Expanded details for Karim Ahmed')).toBeTruthy();
  });

  it('the toggle button is a native tab stop, not part of the roving-tabindex data-cell grid', async () => {
    const user = userEvent.setup();
    render(<Controlled expandable />);
    const cells = screen.getAllByRole('cell');
    // Same reasoning as the checkbox column: the first *data* cell is the
    // roving stop, at index 1 (index 0 is the expand-toggle cell).
    cells[1]?.focus();
    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(document.activeElement).toBe(cells[2]));
  });

  it('the toggle is keyboard-operable — Enter and Space both activate it, same as any native button', async () => {
    const user = userEvent.setup();
    render(<Controlled expandable />);
    const toggle = screen.getByRole('button', { name: 'Details for Rahim Uddin' });

    // Three tab stops precede the first row's toggle: the scrollable
    // region wrapper (`role="region" tabIndex={0}`, the 320px
    // keyboard-scroll technique — see this component's own header
    // comment), then the sortable "Name" column header's own `<button>`
    // (`COLUMNS`' one `sortable: true` column) — both ahead of the toggle
    // in DOM order, which itself sits ahead of that row's one
    // roving-tabindex data cell.
    await user.tab();
    await user.tab();
    await user.tab();
    await waitFor(() => expect(document.activeElement).toBe(toggle));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('true'));

    await user.keyboard(' ');
    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
  });
});
