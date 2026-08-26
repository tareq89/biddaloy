import { AuditAction } from '@biddaloy/shared';
import { http, HttpResponse } from 'msw';

import { auditEntryFactory, type AuditEntry } from '../../factories';
import { paginate } from '../support';

const fixtures: AuditEntry[] = [auditEntryFactory(), auditEntryFactory(), auditEntryFactory()];

const list = http.get('/api/v1/audit-logs', ({ request }) =>
  HttpResponse.json(paginate(fixtures, request.url)),
);

const listEmpty = http.get('/api/v1/audit-logs', ({ request }) =>
  HttpResponse.json(paginate([], request.url)),
);

/**
 * [8.11.10]'s tenant-wide trail, with one row per shape the audit page has
 * to render differently — a field-level UPDATE diff, a CREATE with only
 * new values, a DELETE with only old ones, a bare event with neither
 * (LOGIN), and a system-triggered row with no acting user. Deliberately
 * **not** the default handler: `list` above already backs the Login
 * History tab and the student Activity tab, and changing what those get
 * back would be a change to tests that have nothing to do with this
 * screen.
 */
const listMixedActions = http.get('/api/v1/audit-logs', ({ request }) =>
  HttpResponse.json(paginate(mixedActionFixtures, request.url)),
);

export const mixedActionFixtures: AuditEntry[] = [
  auditEntryFactory({
    id: 'audit-update',
    action: AuditAction.UPDATE,
    entity_type: 'Student',
    entity_id: 'a1b2c3d4-1111-4222-8333-444455556666',
    performed_by_name: 'Fatema Begum',
    old_values: { full_name: 'Rahim', roll_number: 12, is_active: true, admission_date: null },
    new_values: {
      full_name: 'Rahim Uddin',
      roll_number: 12,
      is_active: false,
      admission_date: '2026-01-05',
    },
    created_at: '2026-01-05T10:30:00.000Z',
  }),
  auditEntryFactory({
    id: 'audit-create',
    action: AuditAction.CREATE,
    entity_type: 'FeeStructure',
    entity_id: 'b2c3d4e5-1111-4222-8333-444455556666',
    performed_by_name: 'Fatema Begum',
    old_values: null,
    new_values: { name: 'Monthly Tuition', amount: 1500 },
    created_at: '2026-01-04T09:00:00.000Z',
  }),
  auditEntryFactory({
    id: 'audit-delete',
    action: AuditAction.DELETE,
    entity_type: 'Invoice',
    entity_id: 'c3d4e5f6-1111-4222-8333-444455556666',
    performed_by_name: 'Fatema Begum',
    old_values: { invoice_number: 'INV-00000001' },
    new_values: null,
    created_at: '2026-01-03T08:00:00.000Z',
  }),
  auditEntryFactory({
    id: 'audit-login',
    action: AuditAction.LOGIN,
    entity_type: 'User',
    entity_id: 'd4e5f6a7-1111-4222-8333-444455556666',
    performed_by_name: 'Fatema Begum',
    old_values: null,
    new_values: null,
    created_at: '2026-01-02T07:00:00.000Z',
  }),
  auditEntryFactory({
    id: 'audit-bulk-upload',
    action: AuditAction.BULK_UPLOAD,
    entity_type: 'Student',
    entity_id: null,
    // System-triggered: no acting user, so the page renders "System"
    // rather than a blank cell.
    performed_by_user_id: null,
    performed_by_name: null,
    old_values: null,
    new_values: { created: 42, skipped: 3 },
    created_at: '2026-01-01T06:00:00.000Z',
  }),
];

/** [8.10.2]'s Activity tab — the narrower, entity-scoped sibling of
 * `list` above. `entity_type`/`entity_id` default to matching this
 * route's own path params, same as the real `findByEntity` query. */
const listByEntity = http.get(
  '/api/v1/audit-logs/entity/:entityType/:entityId',
  ({ params, request }) =>
    HttpResponse.json(
      paginate(
        [
          auditEntryFactory({
            entity_type: params.entityType as string,
            entity_id: params.entityId as string,
            // `findByEntity` never joins the `performed_by` relation, so
            // this route's rows really do come back nameless — see
            // `audit-log-response.dto.ts`.
            performed_by_name: null,
          }),
        ],
        request.url,
      ),
    ),
);

const listByEntityEmpty = http.get(
  '/api/v1/audit-logs/entity/:entityType/:entityId',
  ({ request }) => HttpResponse.json(paginate([], request.url)),
);

export const auditLogHandlers = {
  list,
  listEmpty,
  listMixedActions,
  listByEntity,
  listByEntityEmpty,
};

export const auditLogDefaultHandlers = [list, listByEntity];
