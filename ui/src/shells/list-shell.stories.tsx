/**
 * The demo story the issue's own acceptance criteria ask for: a complete
 * list page, with URL-backed state via `useListShellState`, built from
 * nothing but `ListShell` + this package's own `Input`/`Select`/`Button` —
 * no bespoke table markup, no local `useState` standing in for page/sort/
 * filter/selection.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { MemoryRouter } from 'react-router';

import { Button } from '../components/button';
import type { DataTableColumn } from '../components/data-table';
import { Input } from '../components/input';

import { ListShell } from './list-shell';
import { useListShellState } from './use-list-shell-state';

// No router decorator at the `meta` level — react-router doesn't allow
// nesting `<Router>`s, so a story that needs its own `initialEntries`
// (`WithSelection`, `FilteredAndSorted`) can't layer a second
// `MemoryRouter` on top of a shared one. Each story supplies its own
// single `MemoryRouter` instead.
const meta: Meta<typeof ListShell> = {
  title: 'Shells/ListShell',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ListShell>;

interface Student {
  id: string;
  name: string;
  className: string;
}

const ALL_STUDENTS: Student[] = [
  { id: '1', name: 'Rahim Uddin', className: 'Six' },
  { id: '2', name: 'Karim Ahmed', className: 'Seven' },
  { id: '3', name: 'Fatema Begum', className: 'Six' },
  { id: '4', name: 'Nusrat Jahan', className: 'Eight' },
];

const COLUMNS: DataTableColumn<Student>[] = [
  { id: 'name', header: 'Name', accessorFn: (row) => row.name, sortable: true },
  { id: 'className', header: 'Class', accessorFn: (row) => row.className, sortable: true },
];

function StudentsListPage() {
  const [state, actions] = useListShellState({ limit: 20 });

  const filtered = state.filters.q
    ? ALL_STUDENTS.filter((student) =>
        student.name.toLowerCase().includes(state.filters.q!.toLowerCase()),
      )
    : ALL_STUDENTS;

  return (
    <ListShell
      title="Students"
      primaryAction={<Button type="button">Add student</Button>}
      filterBar={
        <Input
          aria-label="Search students"
          placeholder="Search by name…"
          value={state.filters.q ?? ''}
          onChange={(event) => actions.setFilters({ ...state.filters, q: event.target.value })}
        />
      }
      tableId="students-demo"
      caption="Students"
      columns={COLUMNS}
      data={filtered}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      page={state.page}
      pageSize={state.limit}
      totalCount={filtered.length}
      onPageChange={actions.setPage}
      selectedIds={state.selectedIds}
      onSelectedIdsChange={actions.setSelectedIds}
      bulkActions={
        <Button type="button" variant="destructive" size="sm">
          Delete selected
        </Button>
      }
    />
  );
}

export const Default: Story = {
  decorators: [
    (StoryFn) => (
      <MemoryRouter initialEntries={['/students']}>
        <StoryFn />
      </MemoryRouter>
    ),
  ],
  render: () => <StudentsListPage />,
};

export const WithSelection: Story = {
  decorators: [
    (StoryFn) => (
      <MemoryRouter initialEntries={['/students?selected=1,3']}>
        <StoryFn />
      </MemoryRouter>
    ),
  ],
  render: () => <StudentsListPage />,
};

export const FilteredAndSorted: Story = {
  decorators: [
    (StoryFn) => (
      <MemoryRouter initialEntries={['/students?q=Rahim&sort=name&order=asc']}>
        <StoryFn />
      </MemoryRouter>
    ),
  ],
  render: () => <StudentsListPage />,
};
