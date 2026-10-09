import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import type { PrinterRow, PrintTemplateRow } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';

import { PrintPreview } from './print-preview';

/**
 * [32.3.4] `Print/PrintPreview`. Same "client-admin isn't globbed into a running
 * Storybook instance yet" gap `CalendarSection.stories.tsx` notes — written
 * anyway, following that precedent. A loader sets an ADMIN role and a school.
 */
const template: PrintTemplateRow = {
  id: 't-1',
  name: 'Classic',
  document_kind: 'STUDENT_ID_CARD',
  layout_kind: 'FIXED',
  is_default: true,
  batch_size: 50,
  current_version_id: 'v-1',
  archived_at: null,
  created_at: '2027-01-01T00:00:00.000Z',
  updated_at: '2027-01-01T00:00:00.000Z',
};

const printer: PrinterRow = {
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
};

const text = (id: string, extra: object) => ({
  id,
  type: 'TEXT',
  x: 3,
  y: 3,
  w: 50,
  h: 7,
  fontFamily: 'Biddaloy Sans',
  sizePt: 11,
  weight: 700,
  color: '#111111',
  align: 'left',
  overflow: 'SHRINK',
  ...extra,
});

const withPhoto = {
  page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
  front: {
    elements: [
      text('n', { field: 'student.name' }),
      { id: 'ph', type: 'IMAGE', x: 58, y: 3, w: 24, h: 30, field: 'student.photo' },
    ],
  },
};

const handlers = (opts: {
  templates?: PrintTemplateRow[];
  printers?: PrinterRow[];
  photo?: string | null;
}) => [
  http.get('/api/v1/print-templates', () => HttpResponse.json(opts.templates ?? [template])),
  http.get('/api/v1/printers', () => HttpResponse.json(opts.printers ?? [printer])),
  http.get('/api/v1/print-assets', () => HttpResponse.json([])),
  http.post('/api/v1/print-jobs/preview', async ({ request }) => {
    const body = (await request.json()) as { subject_ids: string[] };
    return HttpResponse.json({
      template: {
        id: 't-1',
        batch_size: 50,
        version: { id: 'v-1', version: 1, definition: withPhoto },
      },
      items: body.subject_ids.map((id, i) => ({
        subject_id: id,
        label: `Student ${i + 1}`,
        values: { 'student.name': `Student ${i + 1}` },
        photo_url: opts.photo ?? null,
      })),
    });
  }),
];

const ids = (n: number) => Array.from({ length: n }, (_, i) => `s-${i + 1}`);

const meta: Meta<typeof PrintPreview> = {
  title: 'Print/PrintPreview',
  component: PrintPreview,
  args: {
    documentKind: 'STUDENT_ID_CARD',
    subjectType: 'STUDENT',
    subjectIds: ids(120),
    onCreateTemplate: () => undefined,
    onAddPrinter: () => undefined,
    onDone: () => undefined,
    onClose: () => undefined,
  },
  loaders: [
    () => {
      setActiveTenant('school-1');
      setActiveRole('ADMIN');
    },
  ],
};
export default meta;

type Story = StoryObj<typeof PrintPreview>;

/** 120 people in three batches of 50; the second batch is locked until the first is confirmed. */
export const NormalBatch: Story = {
  parameters: {
    msw: { handlers: handlers({ photo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }) },
  },
};

/** Everyone fits in one round: no round stepper. */
export const OneRound: Story = {
  args: { subjectIds: ids(3) },
  parameters: {
    msw: { handlers: handlers({ photo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }) },
  },
};

/** Reached from the picker, so "Back" is offered next to Print. */
export const FromPicker: Story = {
  args: { subjectIds: ids(3), onBack: () => undefined },
  parameters: {
    msw: { handlers: handlers({ photo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }) },
  },
};

/** Cards have no photo, so pre-flight asks for "Print anyway". */
export const PreflightIssues: Story = {
  args: { subjectIds: ids(3) },
  parameters: { msw: { handlers: handlers({ photo: null }) } },
};

export const NoTemplate: Story = {
  parameters: { msw: { handlers: handlers({ templates: [] }) } },
};

export const NoPrinter: Story = {
  args: { subjectIds: ids(3) },
  parameters: { msw: { handlers: handlers({ printers: [] }) } },
};
