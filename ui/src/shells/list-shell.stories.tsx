/**
 * The demo story the issue's own acceptance criteria ask for: a complete
 * list page, with URL-backed state via `useListShellState`, built from
 * nothing but `ListShell` + this package's own `Input`/`Select`/`Button` —
 * no bespoke table markup, no local `useState` standing in for page/sort/
 * filter/selection.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { Button } from '../components/button';
import type { DataTableColumn } from '../components/data-table';
import { Input } from '../components/input';

import type { FilterFieldDescriptor } from './filter-bar';
import { ListShell } from './list-shell';
import { useListShellState } from './use-list-shell-state';

// No router decorator at the `meta` level — each story needs its own
// `initialEntries` (`WithSelection`, `FilteredAndSorted`), so each
// supplies its own router via `withMemoryRouter` instead of sharing one.
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

function StudentsListPage({
  isFetching = false,
  layout,
}: { isFetching?: boolean; layout?: 'auto' | 'table' | 'cards' } = {}) {
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
      isFetching={isFetching}
      {...(layout !== undefined ? { layout } : {})}
    />
  );
}

export const Default: Story = {
  decorators: [withMemoryRouter(['/students'])],
  render: () => <StudentsListPage />,
};

/** [8.14.6] A filter/page/sort refetch in flight: only the table body
 * dims (via `DataTable`'s `isFetching`) — the title, primary action, and
 * filter bar hold still, since `isFetching` only reaches `DataTable`
 * through `ListShellProps`' `...dataTableProps` spread. */
export const Refetching: Story = {
  decorators: [withMemoryRouter(['/students'])],
  render: () => <StudentsListPage isFetching />,
};

export const WithSelection: Story = {
  decorators: [withMemoryRouter(['/students?selected=1,3'])],
  render: () => <StudentsListPage />,
};

export const FilteredAndSorted: Story = {
  decorators: [withMemoryRouter(['/students?q=Rahim&sort=name&order=asc'])],
  render: () => <StudentsListPage />,
};

/** [8.14.7] Proves `layout` reaches `DataTable` through `ListShell`'s
 * `...dataTableProps` spread with no shell-level change — the title,
 * primary-action slot, and filter bar are untouched; only the list below
 * them switches to cards. */
export const CardMode: Story = {
  decorators: [withMemoryRouter(['/students'])],
  render: () => <StudentsListPage layout="cards" />,
};

// [8.14.8]: `filters` (typed `FilterBarProps`) wired through
// `useListShellState`, in place of `StudentsListPage`'s own hand-rolled
// `filterBar` node above — this is what a page migrated by [8.14.10]
// looks like: a descriptor array, not bespoke markup.
const FILTER_FIELDS: FilterFieldDescriptor[] = [
  {
    kind: 'text',
    key: 'q',
    label: 'Search students',
    placeholder: 'Search by name…',
    primary: true,
  },
  {
    kind: 'select',
    key: 'className',
    label: 'Class',
    allLabel: 'All classes',
    options: [
      { value: 'Six', label: 'Six' },
      { value: 'Seven', label: 'Seven' },
      { value: 'Eight', label: 'Eight' },
    ],
  },
];

function StudentsListPageWithFilterBar() {
  const [state, actions] = useListShellState({ limit: 20 });

  const filtered = ALL_STUDENTS.filter((student) => {
    const matchesQuery = state.filters.q
      ? student.name.toLowerCase().includes(state.filters.q.toLowerCase())
      : true;
    const matchesClass = state.filters.className
      ? student.className === state.filters.className
      : true;
    return matchesQuery && matchesClass;
  });

  return (
    <ListShell
      title="Students"
      primaryAction={<Button type="button">Add student</Button>}
      filters={{ fields: FILTER_FIELDS, values: state.filters, onChange: actions.setFilters }}
      tableId="students-with-filter-bar"
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
      onPageSizeChange={actions.setLimit}
      pageSizeLabel="Rows per page"
      selectedIds={state.selectedIds}
      onSelectedIdsChange={actions.setSelectedIds}
    />
  );
}

// [8.14.10]: FilterBar and the rows-per-page control together — the two
// affordances this ticket's rollout adds to every list page, shown in one
// shell rather than two separate stories.
export const WithFilterBar: Story = {
  decorators: [withMemoryRouter(['/students'])],
  render: () => <StudentsListPageWithFilterBar />,
};
