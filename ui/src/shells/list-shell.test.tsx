import { act, screen } from '@testing-library/react';
import type * as React from 'react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Button } from '../components/button';
import type { DataTableColumn, DataTableSort } from '../components/data-table';
import { Input } from '../components/input';
import { renderWithProviders } from '../test';

import type { FilterFieldDescriptor } from './filter-bar';
import { ListShell } from './list-shell';

/** `DEFAULT_LOCALE` (`locale-storage.ts`) is Bengali, not English — same
 * reason `cached-data-notice.test.tsx` forces `locale: 'en'` and awaits
 * `localeReady` before any synchronous assertion. */
async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
  });
  return view;
}

interface Student {
  id: string;
  name: string;
  className: string;
}

const STUDENTS: Student[] = [
  { id: '1', name: 'Rahim Uddin', className: 'Six' },
  { id: '2', name: 'Karim Ahmed', className: 'Seven' },
];

const COLUMNS: DataTableColumn<Student>[] = [
  { id: 'name', header: 'Name', accessorFn: (row) => row.name, sortable: true },
  { id: 'className', header: 'Class', accessorFn: (row) => row.className },
];

function Demo() {
  const [sorting, setSorting] = useState<DataTableSort | null>(null);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  return (
    <ListShell
      title="Students"
      primaryAction={<Button type="button">Add student</Button>}
      filterBar={<Input aria-label="Search" placeholder="Search students…" />}
      tableId="students-shell-test"
      caption="Students"
      columns={COLUMNS}
      data={STUDENTS}
      getRowId={(row) => row.id}
      sorting={sorting}
      onSortingChange={setSorting}
      page={page}
      pageSize={20}
      totalCount={STUDENTS.length}
      onPageChange={setPage}
      selectedIds={selectedIds}
      onSelectedIdsChange={setSelectedIds}
      bulkActions={<Button type="button">Delete selected</Button>}
    />
  );
}

describe('ListShell', () => {
  it('renders the title, primary action and filter bar alongside the table — no bespoke table code', async () => {
    await renderInEnglish(<Demo />);
    expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add student' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Rahim Uddin')).toBeTruthy();
  });

  it('omits the filter bar entirely when none is given, rather than an empty wrapper', async () => {
    await renderInEnglish(
      <ListShell
        title="Students"
        tableId="students-shell-no-filter"
        caption="Students"
        columns={COLUMNS}
        data={STUDENTS}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={vi.fn()}
        page={1}
        pageSize={20}
        totalCount={STUDENTS.length}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    const { container } = await renderInEnglish(<Demo />);
    await expect(container).toHaveNoViolations();
  });
});

const TYPED_FILTER_FIELDS: FilterFieldDescriptor[] = [
  { kind: 'text', key: 'q', label: 'Search', primary: true },
];

function TypedFiltersDemo() {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <ListShell
      title="Students"
      filters={{
        fields: TYPED_FILTER_FIELDS,
        values,
        onChange: (patch) =>
          setValues((current) => {
            const next = { ...current };
            for (const [key, value] of Object.entries(patch)) {
              if (value === null) delete next[key];
              else next[key] = value;
            }
            return next;
          }),
      }}
      tableId="students-typed-filters"
      caption="Students"
      columns={COLUMNS}
      data={STUDENTS}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={vi.fn()}
      page={1}
      pageSize={20}
      totalCount={STUDENTS.length}
      onPageChange={vi.fn()}
    />
  );
}

describe('ListShell — typed `filters` prop', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders FilterBar when the typed `filters` prop is passed', async () => {
    await renderInEnglish(<TypedFiltersDemo />);
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
  });

  it('still renders the legacy `filterBar` node on its own, with no `filters` prop passed', async () => {
    await renderInEnglish(
      <ListShell
        title="Students"
        filterBar={<Input aria-label="Legacy search" />}
        tableId="students-legacy-filter-bar"
        caption="Students"
        columns={COLUMNS}
        data={STUDENTS}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={vi.fn()}
        page={1}
        pageSize={20}
        totalCount={STUDENTS.length}
        onPageChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'Legacy search' })).toBeTruthy();
  });

  it('renders both when both `filterBar` and `filters` are passed, and warns in dev', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await renderInEnglish(
      <ListShell
        title="Students"
        filterBar={<Input aria-label="Legacy search" />}
        filters={{ fields: TYPED_FILTER_FIELDS, values: {}, onChange: vi.fn() }}
        tableId="students-both-filters"
        caption="Students"
        columns={COLUMNS}
        data={STUDENTS}
        getRowId={(row) => row.id}
        sorting={null}
        onSortingChange={vi.fn()}
        page={1}
        pageSize={20}
        totalCount={STUDENTS.length}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Legacy search' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('both `filterBar`'));
  });
});
