import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { REGION_BD_BN, RegionConfigProvider } from '../i18n';

import { Button } from './button';
import {
  DataTable,
  type DataTableColumn,
  type DataTableProps,
  type DataTableSort,
} from './data-table';

const meta: Meta<typeof DataTable> = {
  title: 'Components/DataTable',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof DataTable>;

interface Student {
  id: string;
  name: string;
  className: string;
  status: string;
}

const STUDENTS: Student[] = [
  { id: '1', name: 'Rahim Uddin', className: 'Six', status: 'Active' },
  { id: '2', name: 'Karim Ahmed', className: 'Seven', status: 'Active' },
  { id: '3', name: 'Fatema Begum', className: 'Six', status: 'Inactive' },
];

const COLUMNS: DataTableColumn<Student>[] = [
  { id: 'name', header: 'Name', accessorFn: (row) => row.name, sortable: true },
  { id: 'className', header: 'Class', accessorFn: (row) => row.className, sortable: true },
  { id: 'status', header: 'Status', accessorFn: (row) => row.status },
];

function Demo(props: {
  data?: Student[];
  totalCount?: number;
  loading?: boolean;
  isFetching?: boolean;
  error?: string;
  selectable?: boolean;
  expandable?: boolean;
  tableId?: string;
  caption?: string;
  columns?: DataTableColumn<Student>[];
  columnsMenu?: boolean;
  pageSize?: number;
  layout?: DataTableProps<Student>['layout'];
  /** [8.14.10] Wires the pager's rows-per-page `Select` to real state, so
   * the story is interactive rather than a static screenshot of the
   * control. */
  withPageSize?: boolean;
}) {
  const {
    data = STUDENTS,
    totalCount = STUDENTS.length,
    loading = false,
    isFetching = false,
    error,
    selectable = false,
    expandable = false,
    tableId = 'students-demo',
    caption = 'Students',
    columns = COLUMNS,
    columnsMenu = false,
    pageSize: initialPageSize = 20,
    layout,
    withPageSize = false,
  } = props;
  const [sorting, setSorting] = useState<DataTableSort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  return (
    <DataTable
      tableId={tableId}
      caption={caption}
      columns={columns}
      data={data}
      getRowId={(row) => row.id}
      sorting={sorting}
      onSortingChange={setSorting}
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      onPageChange={setPage}
      loading={loading}
      isFetching={isFetching}
      columnsMenu={columnsMenu}
      {...(error !== undefined ? { error } : {})}
      {...(layout !== undefined ? { layout } : {})}
      {...(withPageSize
        ? {
            onPageSizeChange: (size: number) => {
              setPageSize(size);
              setPage(1);
            },
          }
        : {})}
      {...(selectable
        ? {
            selectedIds,
            onSelectedIdsChange: setSelectedIds,
            bulkActions: (
              <Button type="button" size="sm" variant="destructive">
                Delete selected
              </Button>
            ),
          }
        : {})}
      {...(expandable
        ? {
            expandRowLabel: (row: Student) => `Details for ${row.name}`,
            renderExpandedRow: (row: Student) => (
              <div className="p-4">
                <p className="text-sm font-medium">Details for {row.name}</p>
                <p className="text-sm text-muted-foreground">
                  Class: {row.className} · Status: {row.status}
                </p>
              </div>
            ),
          }
        : {})}
    />
  );
}

export const Default: Story = {
  render: () => <Demo tableId="students-default" />,
};

/** [8.14.6] First load, no rows exist yet — a table-shaped skeleton
 * (`pageSize` rows, same cell recipe as `SkeletonTable`) instead of a
 * single collapsed "Loading…" cell. */
export const Loading: Story = {
  render: () => <Demo tableId="students-loading" loading pageSize={6} />,
};

/** [8.14.6] Loading combined with `selectable` and `columnsMenu` — proves
 * the skeleton's cell count tracks `colSpanCount` (data columns + the
 * selection column), not just the plain-table case above. */
export const LoadingWithSelection: Story = {
  render: () => (
    <Demo tableId="students-loading-selection" loading selectable columnsMenu pageSize={6} />
  ),
};

/** [8.14.6] A refetch (filter/page/sort change) is in flight: the previous
 * page's rows stay mounted and dimmed instead of the table collapsing to a
 * loading state — see `ui/src/hooks/*QueryOptions`' `placeholderData:
 * keepPreviousData`. */
export const Refetching: Story = {
  render: () => <Demo tableId="students-refetching" isFetching />,
};

export const Empty: Story = {
  render: () => <Demo tableId="students-empty" data={[]} totalCount={0} />,
};

/** Stands in for this issue's "error" state category. */
export const ErrorState: Story = {
  render: () => <Demo tableId="students-error" data={[]} error="Failed to load students" />,
};

export const Selectable: Story = {
  render: () => <Demo tableId="students-selectable" selectable />,
};

/** The opt-in "Columns" toggle — [8.10.1]'s "default columns visible, the
 * rest behind a Columns menu" requirement. Off by default (see `Default`
 * above, which renders no trigger at all); a caller with more columns
 * than belong in the default view turns this on. */
export const WithColumnsMenu: Story = {
  render: () => <Demo tableId="students-columns-menu" columnsMenu />,
};

/** No dedicated "Disabled" story: a table of data has no meaningful
 * disabled state of its own — the closest analogs (a disabled bulk-action
 * button, a disabled pagination control) are already covered by
 * `Button`'s own `Disabled` story. */

/** [8.11.2]'s classes list: rows expand inline to reveal each class's
 * sections, rather than navigating away. */
export const ExpandableRows: Story = {
  render: () => {
    function ExpandableDemo() {
      const [sorting, setSorting] = useState<DataTableSort | null>(null);
      const [page, setPage] = useState(1);
      return (
        <DataTable
          tableId="students-expandable"
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
          expandRowLabel={(row) => `Details for ${row.name}`}
          renderExpandedRow={(row) => (
            <div className="p-4">
              <p className="text-sm font-medium">Details for {row.name}</p>
              <p className="text-sm text-muted-foreground">
                Class: {row.className} · Status: {row.status}
              </p>
            </div>
          )}
        />
      );
    }
    return <ExpandableDemo />;
  },
};

export const RightToLeft: Story = {
  render: () => (
    <Demo
      tableId="students-rtl"
      caption="শিক্ষার্থীগণ"
      columns={[
        { id: 'name', header: 'নাম', accessorFn: (row) => row.name, sortable: true },
        { id: 'className', header: 'শ্রেণি', accessorFn: (row) => row.className },
      ]}
    />
  ),
  decorators: [rtlDecorator],
};

// [8.14.7] Card mode — forced via `layout="cards"` so every story below
// renders the same way regardless of the Storybook canvas's own width.
// `COLUMNS` declares no `card` roles, so these exercise the *default*
// role assignment (first column -> title, `status` -> a `dl` field, same
// as any page that hasn't gone through #374's per-page tuning yet).

export const CardMode: Story = {
  render: () => <Demo tableId="students-card-mode" layout="cards" />,
};

export const CardModeSelectable: Story = {
  render: () => <Demo tableId="students-card-selectable" layout="cards" selectable />,
};

export const CardModeExpandable: Story = {
  render: () => <Demo tableId="students-card-expandable" layout="cards" expandable />,
};

export const CardModeLoading: Story = {
  render: () => <Demo tableId="students-card-loading" layout="cards" loading pageSize={4} />,
};

export const CardModeEmpty: Story = {
  render: () => <Demo tableId="students-card-empty" layout="cards" data={[]} totalCount={0} />,
};

export const CardModeError: Story = {
  render: () => (
    <Demo tableId="students-card-error" layout="cards" data={[]} error="Failed to load students" />
  ),
};

export const CardModeWithColumnsMenu: Story = {
  render: () => <Demo tableId="students-card-columns-menu" layout="cards" columnsMenu />,
};

export const CardModeRightToLeft: Story = {
  render: () => (
    <Demo
      tableId="students-card-rtl"
      layout="cards"
      caption="শিক্ষার্থীগণ"
      columns={[
        { id: 'name', header: 'নাম', accessorFn: (row) => row.name, sortable: true },
        { id: 'className', header: 'শ্রেণি', accessorFn: (row) => row.className },
      ]}
    />
  ),
  decorators: [rtlDecorator],
};

/** [8.14.7]'s `align: 'end'` API, shown in both render modes side by side —
 * a numeric column right-aligns with `tabular-nums` in the table's `<td>`
 * and in the card's `<dd>`. */
export const NumericAlignment: Story = {
  render: () => {
    const balanceColumns: DataTableColumn<Student>[] = [
      { id: 'name', header: 'Name', accessorFn: (row) => row.name, sortable: true },
      {
        id: 'balance',
        header: 'Balance',
        accessorFn: (row) => (row.status === 'Active' ? '৳0.00' : '৳1,250.00'),
        align: 'end',
      },
    ];
    return (
      <div className="flex flex-col gap-6">
        <Demo tableId="students-align-table" layout="table" columns={balanceColumns} />
        <Demo tableId="students-align-cards" layout="cards" columns={balanceColumns} />
      </div>
    );
  },
};

/** [8.14.7] `layout="auto"` (the default) picks a render mode from this
 * table's own container width — the `viewport` addon parameter narrows
 * the Storybook canvas below the `md` breakpoint, the same technique
 * `app-shell.stories.tsx` uses for its own mobile-nav story, so the
 * switch to cards is demonstrable here rather than only assertable in
 * `data-table.test.tsx` (which forces the mode with an explicit prop
 * since jsdom's `ResizeObserver` never actually fires). */
export const Responsive: Story = {
  render: () => <Demo tableId="students-responsive" layout="auto" />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** [8.14.10] The pager's rows-per-page control, table mode. Changing it
 * resets to page 1 (see `Demo`'s `onPageSizeChange`), same contract
 * `ListShell`'s `setLimit` action gives every migrated page. */
export const WithPageSize: Story = {
  render: () => (
    <Demo tableId="students-with-page-size" layout="table" totalCount={100} withPageSize />
  ),
};

/** Same control, card mode — `DataTable` renders one shared pager for
 * both layouts, so this exercises that it survives the card-mode
 * render path too, not just table mode. */
export const CardModeWithPageSize: Story = {
  render: () => (
    <Demo tableId="students-card-with-page-size" layout="cards" totalCount={100} withPageSize />
  ),
};

/** [8.14.10] / [8.14.15] `১০ / ২০ / ৫০` — the rows-per-page options render
 * through `formatNumber`, so they pick up Bengali numerals under a `bn`
 * `RegionConfig` the same way any other count on the page does.
 * `globals: { locale: 'bn' }` also switches every `t()`-backed string
 * (`Rows per page`, `Page X of Y`, `Previous`/`Next`) to Bangla, and
 * selection is pre-populated so `{n} selected` is on screen too — all of
 * [8.14.15]'s ~13 `DataTable` strings visible in one story. */
export const Bangla: Story = {
  render: () => (
    <RegionConfigProvider value={REGION_BD_BN}>
      <Demo
        tableId="students-with-page-size-bn"
        layout="table"
        totalCount={100}
        withPageSize
        selectable
      />
    </RegionConfigProvider>
  ),
  globals: { locale: 'bn' },
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('storybook/test');
    const canvas = within(canvasElement);
    const checkboxes = canvas.getAllByRole('checkbox');
    await userEvent.click(checkboxes[1] as HTMLElement);
  },
};

/** Same story, card mode — proves `DataTableCards` (fed from the same
 * resolved labels) inherits the Bangla strings too, not just table mode. */
export const BanglaCardMode: Story = {
  render: () => (
    <RegionConfigProvider value={REGION_BD_BN}>
      <Demo
        tableId="students-with-page-size-bn-cards"
        layout="cards"
        totalCount={100}
        withPageSize
        selectable
      />
    </RegionConfigProvider>
  ),
  globals: { locale: 'bn' },
};
