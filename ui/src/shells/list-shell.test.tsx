import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '../components/button';
import type { DataTableColumn, DataTableSort } from '../components/data-table';
import { Input } from '../components/input';

import { ListShell } from './list-shell';

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
  it('renders the title, primary action and filter bar alongside the table — no bespoke table code', () => {
    render(<Demo />);
    expect(screen.getByRole('heading', { name: 'Students' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add student' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeTruthy();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.getByText('Rahim Uddin')).toBeTruthy();
  });

  it('omits the filter bar entirely when none is given, rather than an empty wrapper', () => {
    render(
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
    const { container } = render(<Demo />);
    await expect(container).toHaveNoViolations();
  });
});
