import { http, HttpResponse } from 'msw';

/**
 * [12.6] `POST /users/invitations/preview` / `.../batch` /
 * `GET .../batch/:id` — untyped in `schema.d.ts` (no `@ApiResponse` on
 * these routes), same as `communications.ts`'s bulk-reminder preview.
 * Registered **before** `getOne`/`update` (`/api/v1/users/:id`) matters
 * only for `:id`-shaped routes; these are `invitations/...` literal
 * segments, so ordering relative to `users.ts`'s handlers doesn't matter,
 * but they are still declared above `GET /users/:id` in the server for
 * the same reason `users/me` is.
 */
const previewInvitations = http.post('/api/v1/users/invitations/preview', () =>
  HttpResponse.json({
    total: 2,
    to_invite: [
      { guardian_id: 'guardian-1', full_name: 'Rahim Uddin', channel: 'SMS', user_exists: false },
      {
        guardian_id: 'guardian-2',
        full_name: 'Karim Mia',
        channel: 'EMAIL',
        user_exists: true,
      },
    ],
    skipped: [
      { guardian_id: 'guardian-3', full_name: 'No Contact Guardian', reason: 'no_contact' },
    ],
  }),
);

const previewInvitationsAllSkipped = http.post('/api/v1/users/invitations/preview', () =>
  HttpResponse.json({
    total: 1,
    to_invite: [],
    skipped: [
      { guardian_id: 'guardian-1', full_name: 'Already Active Guardian', reason: 'already_active' },
    ],
  }),
);

const dispatchInvitations = http.post('/api/v1/users/invitations/batch', () =>
  HttpResponse.json(
    {
      batch_id: 'batch-1',
      queued: 2,
      skipped: [
        { guardian_id: 'guardian-3', full_name: 'No Contact Guardian', reason: 'no_contact' },
      ],
    },
    { status: 202 },
  ),
);

const getBatchStatusProgressing = http.get('/api/v1/users/invitations/batch/:id', ({ params }) =>
  HttpResponse.json({ batch_id: params.id, total: 2, sent: 1, failed: 0, queued: 1 }),
);

const getBatchStatusDone = http.get('/api/v1/users/invitations/batch/:id', ({ params }) =>
  HttpResponse.json({ batch_id: params.id, total: 2, sent: 2, failed: 0, queued: 0 }),
);

export const invitationHandlers = {
  previewInvitations,
  previewInvitationsAllSkipped,
  dispatchInvitations,
  getBatchStatusProgressing,
  getBatchStatusDone,
};

export const invitationDefaultHandlers = [
  previewInvitations,
  dispatchInvitations,
  getBatchStatusDone,
];
