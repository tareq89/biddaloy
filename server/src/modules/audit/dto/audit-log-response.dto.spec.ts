import { describe, it, expect } from 'vitest';
import { AuditAction } from '@biddaloy/shared';
import { AuditLogResponseDto } from './audit-log-response.dto';
import { AuditLog } from '../entities/audit-log.entity';

function auditLogEntity(overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: 'log-1',
    tenant: null,
    tenant_id: 'tenant-1',
    action: AuditAction.UPDATE,
    entity_type: 'Student',
    entity_id: 'student-1',
    performed_by: null,
    performed_by_user_id: 'user-1',
    old_values: { full_name: 'Rahim' },
    new_values: { full_name: 'Rahim Uddin' },
    ip_address: '203.0.113.4',
    user_agent: 'Mozilla/5.0',
    created_at: new Date('2026-01-05T10:30:00.000Z'),
    ...overrides,
  } as AuditLog;
}

describe('AuditLogResponseDto.fromEntity', () => {
  // [8.11.10]'s "Who" column: `findAll` joins the acting user, so the row
  // must carry a readable name, not just the UUID.
  it('flattens the joined user’s full_name into performed_by_name', () => {
    const dto = AuditLogResponseDto.fromEntity(
      auditLogEntity({
        performed_by: { id: 'user-1', full_name: 'Fatema Begum' } as AuditLog['performed_by'],
      }),
    );

    expect(dto.performed_by_name).toBe('Fatema Begum');
    expect(dto.performed_by_user_id).toBe('user-1');
  });

  // Three separate causes, one rendering ("System" client-side): a
  // system-triggered action, a since-deleted user (`onDelete: 'SET NULL'`),
  // and `findByEntity`, which never joins the relation at all.
  it('is null when the relation was never joined or the user is gone', () => {
    const dto = AuditLogResponseDto.fromEntity(auditLogEntity({ performed_by: null }));

    expect(dto.performed_by_name).toBeNull();
  });

  it('is null for a system-triggered action with no acting user', () => {
    const dto = AuditLogResponseDto.fromEntity(
      auditLogEntity({ performed_by: null, performed_by_user_id: null }),
    );

    expect(dto.performed_by_user_id).toBeNull();
    expect(dto.performed_by_name).toBeNull();
  });

  // The rest of the row is a straight copy — asserted once so a future
  // field added to the entity but forgotten here shows up as a diff.
  it('copies the remaining columns through unchanged', () => {
    const entity = auditLogEntity();
    const dto = AuditLogResponseDto.fromEntity(entity);

    expect(dto).toMatchObject({
      id: 'log-1',
      tenant_id: 'tenant-1',
      action: AuditAction.UPDATE,
      entity_type: 'Student',
      entity_id: 'student-1',
      old_values: { full_name: 'Rahim' },
      new_values: { full_name: 'Rahim Uddin' },
      ip_address: '203.0.113.4',
      user_agent: 'Mozilla/5.0',
      created_at: entity.created_at,
    });
  });
});
