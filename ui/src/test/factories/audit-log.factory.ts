import { AuditAction } from '@biddaloy/shared';

import type { components } from '../../api/schema';

import { FACTORY_REFERENCE_DATE, faker } from './faker';

export type AuditEntry = components['schemas']['AuditLogResponseDto'];

export function auditEntryFactory(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: faker.string.uuid(),
    tenant_id: faker.string.uuid(),
    action: AuditAction.UPDATE,
    entity_type: 'Student',
    entity_id: faker.string.uuid(),
    performed_by_user_id: faker.string.uuid(),
    old_values: null,
    new_values: null,
    ip_address: faker.internet.ip(),
    user_agent: faker.internet.userAgent(),
    created_at: faker.date.recent({ refDate: FACTORY_REFERENCE_DATE }).toISOString(),
    ...overrides,
  };
}
