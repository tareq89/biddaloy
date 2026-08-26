import { http, HttpResponse } from 'msw';

import { communicationFactory, type Communication } from '../../factories';
import { faker } from '../../factories/faker';

const previewReminder = http.post(
  '/api/v1/communications/reminder/single/:studentId/preview',
  ({ params }) =>
    HttpResponse.json({
      student_id: params.studentId as string,
      recipients: [
        {
          guardian_id: faker.string.uuid(),
          guardian_name: 'Guardian',
          medium: 'SMS',
          address: '+8801700000000',
          message_body: 'Your child has a pending fee due.',
          subject: null,
        },
      ],
      skipped: [],
    }),
);

const sendSingleReminder = http.post(
  '/api/v1/communications/reminder/single/:studentId',
  ({ params }) =>
    HttpResponse.json({
      student_id: params.studentId as string,
      sent: [
        {
          communication_log_id: faker.string.uuid(),
          guardian_id: faker.string.uuid(),
          guardian_name: 'Guardian',
          medium: 'SMS',
          status: 'QUEUED',
        },
      ],
      skipped: [],
    }),
);

const sendBulkReminder = http.post('/api/v1/communications/reminder/bulk', () =>
  HttpResponse.json(
    {
      id: faker.string.uuid(),
      batch_name: 'August dues reminder',
      status: 'PROCESSING',
      total_recipients: 50,
      successful_count: 0,
      failed_count: 0,
      message_template: null,
      created_at: new Date().toISOString(),
      // Targeting the batch was sent with — the detail page replays it on retry.
      mediums: null,
      whatsapp_template_name: null,
      whatsapp_template_language: null,
      whatsapp_template_params: null,
      skipped: [],
    },
    { status: 201 },
  ),
);

const getBulkReminder = http.get('/api/v1/communications/reminder/bulk/:id', ({ params }) =>
  HttpResponse.json({
    id: params.id as string,
    batch_name: 'August dues reminder',
    status: 'COMPLETED',
    total_recipients: 50,
    successful_count: 48,
    failed_count: 2,
    message_template: null,
    created_at: new Date().toISOString(),
    mediums: null,
    whatsapp_template_name: null,
    whatsapp_template_language: null,
    whatsapp_template_params: null,
    skipped: [
      { student_id: faker.string.uuid(), guardian_id: null, reason: 'No guardian on file' },
      {
        student_id: faker.string.uuid(),
        guardian_id: faker.string.uuid(),
        reason: 'Invalid phone number',
      },
    ],
  }),
);

/** [8.11.9]'s bulk wizard review step — echoes the requested students
 * back with one resolved recipient each, plus one skipped guardian, so a
 * test can assert both halves of the mandatory preview without wiring
 * its own handler. */
const previewBulkReminder = http.post(
  '/api/v1/communications/reminder/bulk/preview',
  async ({ request }) => {
    const body = (await request.json()) as { student_ids?: string[] };
    const studentIds = body.student_ids ?? [];
    return HttpResponse.json({
      total_students: studentIds.length,
      recipients_count: studentIds.length,
      skipped_count: 1,
      students: studentIds.map((studentId, index) => ({
        student_id: studentId,
        student_name: `Student ${index + 1}`,
        recipients: [
          {
            guardian_id: faker.string.uuid(),
            guardian_name: 'Guardian',
            medium: 'SMS',
            address: '+8801700000000',
            message_body: 'Your child has pending fee due.',
            subject: null,
          },
        ],
        skipped:
          index === 0
            ? [
                {
                  guardian_id: faker.string.uuid(),
                  guardian_name: 'Skipped Guardian',
                  reason: 'guardian_has_no_address_for_preferred_medium',
                },
              ]
            : [],
      })),
    });
  },
);

function batchListItem(overrides: Record<string, unknown> = {}) {
  return {
    id: faker.string.uuid(),
    batch_name: 'August dues reminder',
    status: 'COMPLETED',
    total_recipients: 50,
    successful_count: 48,
    failed_count: 2,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

const listBulkReminders = http.get('/api/v1/communications/reminder/bulk', () =>
  HttpResponse.json({
    data: [
      batchListItem(),
      batchListItem({ batch_name: 'July dues reminder', status: 'PROCESSING', failed_count: 0 }),
    ],
    total: 2,
    page: 1,
    limit: 20,
    totalPages: 1,
  }),
);

const listBulkRemindersEmpty = http.get('/api/v1/communications/reminder/bulk', () =>
  HttpResponse.json({ data: [], total: 0, page: 1, limit: 20, totalPages: 0 }),
);

const getBulkReminderLogs = http.get('/api/v1/communications/reminder/bulk/:id/logs', () =>
  HttpResponse.json({
    data: [
      {
        id: faker.string.uuid(),
        medium: 'SMS',
        recipient_address: '+8801700000000',
        recipient_name: 'Guardian One',
        status: 'SENT',
        student_id: faker.string.uuid(),
        guardian_id: faker.string.uuid(),
        provider_message_id: faker.string.uuid(),
        error: null,
        created_at: new Date().toISOString(),
      },
      {
        id: faker.string.uuid(),
        medium: 'SMS',
        recipient_address: '+8801700000001',
        recipient_name: 'Guardian Two',
        status: 'FAILED',
        student_id: faker.string.uuid(),
        guardian_id: faker.string.uuid(),
        provider_message_id: null,
        error: 'Provider rejected the number',
        created_at: new Date().toISOString(),
      },
    ],
    total: 2,
    page: 1,
    limit: 50,
    totalPages: 1,
  }),
);

const send = http.post('/api/v1/communications/send', () =>
  HttpResponse.json(communicationFactory(), { status: 201 }),
);

const getOne = http.get('/api/v1/communications/:id', ({ params }) =>
  HttpResponse.json(communicationFactory({ id: params.id as string }) satisfies Communication),
);

/** [8.10.2]'s Communication tab. */
const listByStudent = http.get('/api/v1/communications/student/:studentId', () =>
  HttpResponse.json([communicationFactory(), communicationFactory()] satisfies Communication[]),
);

const listByStudentEmpty = http.get('/api/v1/communications/student/:studentId', () =>
  HttpResponse.json([]),
);

/** [8.11.4]'s Communication History tab. */
const listByGuardian = http.get('/api/v1/communications/guardian/:guardianId', () =>
  HttpResponse.json([communicationFactory(), communicationFactory()] satisfies Communication[]),
);

const listByGuardianEmpty = http.get('/api/v1/communications/guardian/:guardianId', () =>
  HttpResponse.json([]),
);

/** [8.10.4]'s dues queue "Last reminder" column — empty by default (no
 * fixture student id ever matches), same "opt in per test" shape
 * `listByStudentEmpty` sets for the single-student version. */
const lastReminders = http.get('/api/v1/communications/last-reminders', () =>
  HttpResponse.json([]),
);

export const communicationHandlers = {
  previewReminder,
  sendSingleReminder,
  sendBulkReminder,
  previewBulkReminder,
  listBulkReminders,
  listBulkRemindersEmpty,
  getBulkReminder,
  getBulkReminderLogs,
  send,
  getOne,
  listByStudent,
  listByStudentEmpty,
  listByGuardian,
  listByGuardianEmpty,
  lastReminders,
};

export const communicationDefaultHandlers = [
  previewReminder,
  sendSingleReminder,
  sendBulkReminder,
  previewBulkReminder,
  listBulkReminders,
  getBulkReminder,
  getBulkReminderLogs,
  send,
  getOne,
  listByStudent,
  listByGuardian,
  lastReminders,
];
