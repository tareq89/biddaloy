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

export const auditLogHandlers = { list, listEmpty };

export const auditLogDefaultHandlers = [list];
