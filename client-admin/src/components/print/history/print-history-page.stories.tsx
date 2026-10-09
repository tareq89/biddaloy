import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import type { PrintHistoryRow } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { HistoryItemDialog } from './history-item-dialog';
import { PrintHistoryPage } from './print-history-page';

/**
 * [32.3.5] `Print/PrintHistory`. Same "client-admin isn't globbed into a running
 * Storybook instance yet" gap `CalendarSection.stories.tsx` notes — written
 * anyway, following that precedent. A loader sets an ADMIN role and a school.
 */
const row = (over: Partial<PrintHistoryRow>): PrintHistoryRow => ({
  item_id: 'i-1',
  job_id: 'job-1',
  created_at: '2027-03-01T10:00:00.000Z',
  printed_by_name: 'Nadia Front Desk',
  template_name: 'Classic',
  template_version: 2,
  document_kind: 'STUDENT_ID_CARD',
  subject_type: 'STUDENT',
  subject_id: 's-1',
  subject_label: 'Rahim Ahmed',
  copy_number: 1,
  outcome: 'OK',
  revoked_at: null,
  job_status: 'CONFIRMED',
  ...over,
});

const history = (rows: PrintHistoryRow[]) => ({
  msw: {
    handlers: [
      http.get('/api/v1/print-history', () =>
        HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 25, totalPages: 1 }),
      ),
      http.get('/api/v1/print-templates', () => HttpResponse.json([])),
      http.get('/api/v1/users', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
    ],
  },
});

const meta: Meta<typeof PrintHistoryPage> = {
  title: 'Print/PrintHistory',
  component: PrintHistoryPage,
  args: { search: {}, onSearchChange: () => undefined, onPrintIdCards: () => undefined },
  loaders: [
    () => {
      setActiveTenant('school-1');
      setActiveRole('ADMIN');
    },
  ],
};
export default meta;

type Story = StoryObj<typeof PrintHistoryPage>;

export const Populated: Story = {
  parameters: history([
    row({}),
    row({ item_id: 'i-2', subject_label: 'Karim Uddin', copy_number: 2, outcome: 'FAILED' }),
    row({ item_id: 'i-3', subject_label: 'Salma Begum', revoked_at: '2027-03-02T00:00:00.000Z' }),
  ]),
};

export const Empty: Story = {
  parameters: history([]),
};

export const ItemDialog: StoryObj<typeof HistoryItemDialog> = {
  render: () => <HistoryItemDialog open onOpenChange={() => undefined} itemId="i-1" />,
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/print-history/items/i-1', () =>
          HttpResponse.json({
            ...row({}),
            data_snapshot: {
              values: { 'student.name': 'Rahim Ahmed' },
              photoKey: null,
              copyNumber: 1,
              issuedAt: '2027-03-01T10:00:00.000Z',
            },
            revoke_reason: null,
            template_definition: {
              page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
              front: {
                elements: [
                  {
                    id: 'n',
                    type: 'TEXT',
                    x: 3,
                    y: 3,
                    w: 60,
                    h: 8,
                    fontFamily: 'Biddaloy Sans',
                    sizePt: 12,
                    weight: 700,
                    color: '#111111',
                    align: 'left',
                    overflow: 'SHRINK',
                    field: 'student.name',
                  },
                ],
              },
            },
          }),
        ),
      ],
    },
  },
};
