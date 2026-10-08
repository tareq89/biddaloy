import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';

import { IssueCertificateModal } from './issue-certificate-modal';

/**
 * [48.3.B-01] `Print/IssueCertificateModal`. Same "client-admin isn't globbed into a running
 * Storybook instance yet" gap `PrintPreview.stories.tsx` notes; written anyway, following that precedent.
 */
const student = {
  id: 's-1',
  full_name: 'Rafi Hasan',
  registration_number: 'REG-2022-0142',
  roll_number: 8,
  enrollment_status: 'ACTIVE',
  class_section_id: 'cs-1',
  class_section: { id: 'cs-1', class_id: 'c-10', section_name: 'A', class: { name: 'Class 10' } },
};

const text = (id: string, field: string) => ({
  id,
  type: 'TEXT',
  x: 10,
  y: id === 'e1' ? 10 : 30,
  w: 120,
  h: 10,
  fontFamily: 'Biddaloy Sans',
  sizePt: 12,
  weight: 400,
  color: '#000000',
  align: 'left',
  overflow: 'CLIP',
  field,
});

const handlers = (opts: { noTemplate?: boolean; leftSchool?: boolean } = {}) => [
  http.get('/api/v1/students/s-1', () =>
    HttpResponse.json({
      ...student,
      enrollment_status: opts.leftSchool ? 'TRANSFERRED' : 'ACTIVE',
    }),
  ),
  http.get('/api/v1/students/s-1/lifecycle-events', () => HttpResponse.json([])),
  http.get('/api/v1/certificates/templates', () =>
    HttpResponse.json(
      opts.noTemplate
        ? []
        : [
            { id: 't-bn', name: 'Classic (Bangla)', is_default: true, current_version_id: 'v-1' },
            { id: 't-en', name: 'Classic (English)', is_default: false, current_version_id: 'v-2' },
          ],
    ),
  ),
  http.post('/api/v1/certificates/preview', () =>
    HttpResponse.json({
      template: {
        id: 't-bn',
        batch_size: 50,
        version: {
          id: 'v-1',
          version: 1,
          definition: {
            page: { widthMm: 210, heightMm: 148, sides: ['front'] },
            front: { elements: [text('e1', 'student.name'), text('e2', 'issue.conduct')] },
          },
        },
      },
      items: [
        {
          subject_id: 's-1',
          label: 'Rafi Hasan',
          values: { 'student.name': 'Rafi Hasan', 'student.class': 'Class 10' },
          photo_url: null,
        },
      ],
    }),
  ),
  http.get('/api/v1/certificates/printers', () => HttpResponse.json([])),
  http.get('/api/v1/certificates/assets', () => HttpResponse.json([])),
  http.get('/api/v1/print-history/register', () =>
    HttpResponse.json({
      data: [
        {
          item_id: 'i-1',
          document_kind: 'TESTIMONIAL',
          serial: 'TSM-2026-00009',
          serial_year: 2026,
          serial_no: 9,
          copy_number: 1,
          subject_id: 'x',
          subject_label: 'x',
          class_name: null,
          issued_at: '2026-10-01T00:00:00.000Z',
          printed_by_name: null,
          revoked_at: null,
          revoke_reason: null,
        },
      ],
      total: 8,
      page: 1,
      limit: 1,
      totalPages: 8,
    }),
  ),
];

const meta: Meta<typeof IssueCertificateModal> = {
  title: 'Print/IssueCertificateModal',
  component: IssueCertificateModal,
  args: {
    studentId: 's-1',
    onClose: () => undefined,
    onRecordLeaving: () => undefined,
  },
  loaders: [
    () => {
      setActiveTenant('school-1');
      setActiveRole('OFFICE_STAFF');
    },
  ],
};
export default meta;

type Story = StoryObj<typeof IssueCertificateModal>;

/** Step 1, populated: the transfer certificate is disabled and says why. */
export const PickKind: Story = {
  parameters: { msw: { handlers: handlers() } },
};

/** Step 1, loading: the student, events and templates have not answered yet. */
export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/students/s-1', async () => {
          await delay('infinite');
          return HttpResponse.json(student);
        }),
      ],
    },
  },
};

/** Step 1, empty: no kind has a published template, so every card is disabled. */
export const NoTemplates: Story = {
  parameters: { msw: { handlers: handlers({ noTemplate: true }) } },
};

/** Step 1, a former student: study certificate and testimonial are disabled. */
export const FormerStudent: Story = {
  parameters: { msw: { handlers: handlers({ leftSchool: true }) } },
};

/** Opened on a kind: Next goes to language, the typed conduct line, the profile card and the next serial. */
export const OnKind: Story = {
  args: { initialKind: 'TESTIMONIAL' },
  parameters: { msw: { handlers: handlers() } },
};

/** Step 4 has no printer yet: the "add one in Settings" message. */
export const ErrorNoPrinter: Story = {
  args: { initialKind: 'TESTIMONIAL' },
  parameters: { msw: { handlers: handlers() } },
};
