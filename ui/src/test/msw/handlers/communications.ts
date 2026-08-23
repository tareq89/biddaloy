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
  getBulkReminder,
  send,
  getOne,
  listByStudent,
  listByStudentEmpty,
  lastReminders,
};

export const communicationDefaultHandlers = [
  previewReminder,
  sendSingleReminder,
  sendBulkReminder,
  getBulkReminder,
  send,
  getOne,
  listByStudent,
  lastReminders,
];
