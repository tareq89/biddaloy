import type { CalendarImportRow, CalendarImportSummary } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import * as React from 'react';

import { ImportPreviewTable } from './-import-preview-table';

/**
 * [17.5.3] Step 2 of the import wizard, stubbed against static rows —
 * same "client-admin isn't globbed into a running Storybook instance
 * yet" precedent as `-calendar-view.stories.tsx`.
 */
const meta: Meta<typeof ImportPreviewTable> = {
  title: 'client-admin/calendar/ImportPreviewTable',
  component: ImportPreviewTable,
};
export default meta;

type Story = StoryObj<typeof ImportPreviewTable>;

function summary(overrides: Partial<CalendarImportSummary> = {}): CalendarImportSummary {
  return { new: 0, updated: 0, unchanged: 0, error: 0, ...overrides };
}

function Wrapper(props: { rows: CalendarImportRow[]; summary: CalendarImportSummary }) {
  const [allowPartial, setAllowPartial] = React.useState(false);
  return (
    <ImportPreviewTable
      summary={props.summary}
      rows={props.rows}
      allowPartial={allowPartial}
      onAllowPartialChange={setAllowPartial}
    />
  );
}

export const Mixed: Story = {
  render: () => (
    <Wrapper
      summary={summary({ new: 1, updated: 1, unchanged: 1, error: 1 })}
      rows={[
        { row: 2, status: 'NEW', errors: [] },
        { row: 3, status: 'UPDATED', errors: [] },
        { row: 4, status: 'UNCHANGED', errors: [] },
        {
          row: 5,
          status: 'ERROR',
          errors: [{ row: 5, column: null, message: 'End date is before start date', severity: 'error' }],
        },
      ]}
    />
  ),
};

export const AllClean: Story = {
  render: () => (
    <Wrapper
      summary={summary({ new: 3 })}
      rows={[
        { row: 2, status: 'NEW', errors: [] },
        { row: 3, status: 'NEW', errors: [] },
        { row: 4, status: 'NEW', errors: [] },
      ]}
    />
  ),
};

export const AllError: Story = {
  render: () => (
    <Wrapper
      summary={summary({ error: 2 })}
      rows={[
        {
          row: 2,
          status: 'ERROR',
          errors: [{ row: 2, column: 'type', message: 'Unrecognized event type', severity: 'error' }],
        },
        {
          row: 3,
          status: 'ERROR',
          errors: [{ row: 3, column: null, message: 'Missing required column: name', severity: 'error' }],
        },
      ]}
    />
  ),
};
