import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import type { PrinterRow } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { PrinterFormDialog } from './printer-form-dialog';
import { PrintersSection } from './PrintersSection';

/**
 * [32.3.7] Settings › Printers. Same "client-admin isn't globbed into a running
 * Storybook instance yet" gap `CalendarSection.stories.tsx` notes — written
 * anyway, following that precedent. The section needs an ADMIN role
 * (PRINT_TEMPLATE_MANAGE), so a loader sets one before each story renders.
 */
const printer = (over: Partial<PrinterRow>): PrinterRow => ({
  id: 'p-1',
  name: 'Front office',
  printer_type: 'CARD',
  margin_top_mm: 0,
  margin_right_mm: 0,
  margin_bottom_mm: 0,
  margin_left_mm: 0,
  offset_x_mm: 0,
  offset_y_mm: 0,
  scale: 1,
  duplex_order: 'INTERLEAVED',
  sheet_gap_mm: 2,
  archived_at: null,
  ...over,
});

const withPrinters = (rows: PrinterRow[]) => ({
  msw: { handlers: [http.get('/api/v1/printers', () => HttpResponse.json(rows))] },
});

const meta: Meta<typeof PrintersSection> = {
  title: 'Settings/Printers',
  component: PrintersSection,
  loaders: [
    () => {
      setActiveTenant('school-1');
      setActiveRole('ADMIN');
    },
  ],
};
export default meta;

type Story = StoryObj<typeof PrintersSection>;

export const Empty: Story = {
  parameters: withPrinters([]),
};

export const TwoPrinters: Story = {
  parameters: withPrinters([
    printer({ id: 'p-1', name: 'Front office', offset_x_mm: 1.5, offset_y_mm: -0.5 }),
    printer({
      id: 'p-2',
      name: 'Staff room laser',
      printer_type: 'OFFICE',
      margin_top_mm: 5,
      margin_right_mm: 5,
      margin_bottom_mm: 5,
      margin_left_mm: 5,
      duplex_order: 'GROUPED',
    }),
  ]),
};

export const AddPrinterDialog: StoryObj<typeof PrinterFormDialog> = {
  render: () => <PrinterFormDialog open onOpenChange={() => undefined} />,
};

export const EditPrinterDialog: StoryObj<typeof PrinterFormDialog> = {
  render: () => (
    <PrinterFormDialog
      open
      onOpenChange={() => undefined}
      printer={printer({ name: 'Staff room laser', printer_type: 'OFFICE', margin_left_mm: 5 })}
    />
  ),
};
