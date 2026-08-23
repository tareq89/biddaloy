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
          }),
        ],
        request.url,
      ),
    ),
);

const listByEntityEmpty = http.get('/api/v1/audit-logs/entity/:entityType/:entityId', () =>
  HttpResponse.json(paginate([], 'http://localhost/api/v1/audit-logs/entity/Student/1')),
);

export const auditLogHandlers = { list, listEmpty, listByEntity, listByEntityEmpty };

export const auditLogDefaultHandlers = [list, listByEntity];
