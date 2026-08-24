import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Button } from './button';
import { DataTable, type DataTableColumn, type DataTableSort } from './data-table';

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
  error?: string;
  selectable?: boolean;
  tableId?: string;
  caption?: string;
  columns?: DataTableColumn<Student>[];
  columnsMenu?: boolean;
}) {
  const {
    data = STUDENTS,
    totalCount = STUDENTS.length,
    loading = false,
    error,
    selectable = false,
    tableId = 'students-demo',
    caption = 'Students',
    columns = COLUMNS,
    columnsMenu = false,
  } = props;
  const [sorting, setSorting] = useState<DataTableSort | null>(null);
  const [page, setPage] = useState(1);
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
      pageSize={20}
      totalCount={totalCount}
      onPageChange={setPage}
      loading={loading}
      columnsMenu={columnsMenu}
      {...(error !== undefined ? { error } : {})}
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
    />
  );
}

export const Default: Story = {
  render: () => <Demo tableId="students-default" />,
};

export const Loading: Story = {
  render: () => <Demo tableId="students-loading" loading />,
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
