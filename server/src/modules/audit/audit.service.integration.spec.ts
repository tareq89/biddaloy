import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditAction } from '@biddaloy/shared';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { QueryAuditLogDto } from './dto/audit-log.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

/**
 * Integration tests for [8.11.10]'s "Who" column against a real Postgres
 * database. `findAll` left-joins the acting user to flatten their name
 * onto each row, and the one thing that can go wrong there — TypeORM
 * quietly appending `performed_by.deleted_at IS NULL` to the join — is a
 * SQL-level behaviour. `audit.service.spec.ts` can only assert that
 * `withDeleted()` was *called*; that a soft-deleted user's name actually
 * comes back has to be asserted against the database.
 *
 * Rows go through `AuditLogResponseDto.fromEntity` exactly as
 * `AuditController.findAll` maps them — `findAll` itself returns entities,
 * and `performed_by_name` is the DTO's flattening of the joined relation.
 */
describe('AuditService (integration)', () => {
  let service: AuditService;
  let auditLogRepo: Repository<AuditLog>;
  let dataSource: DataSource;

  const TENANT_ID = '00000000-0000-4000-8000-0000000003a1';
  const ACTIVE_USER_ID = '00000000-0000-4000-8000-0000000003a2';
  const REMOVED_USER_ID = '00000000-0000-4000-8000-0000000003a3';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [AuditService], [], {
      synchronize: true,
      dropSchema: true,
    });

    service = module.get<AuditService>(AuditService);
    auditLogRepo = module.get<Repository<AuditLog>>(getRepositoryToken(AuditLog));
    dataSource = module.get(DataSource);

    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({ id: TENANT_ID, name: 'Audit Integration School', slug: 'audit-int' }),
    );

    const userRepo = dataSource.getRepository(User);
    await userRepo.save([
      userRepo.create({
        id: ACTIVE_USER_ID,
        email: 'active@example.com',
        password_hash: 'x',
        full_name: 'Fatema Begum',
      }),
      userRepo.create({
        id: REMOVED_USER_ID,
        email: 'removed@example.com',
        password_hash: 'x',
        full_name: 'Kamrul Hasan',
      }),
    ]);
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query('DELETE FROM audit_logs');
    // Undo the soft delete one test performs, so ordering between tests
    // never decides what "Who" resolves to.
    await dataSource.query('UPDATE users SET deleted_at = NULL');
  });

  async function listAsDtos(): Promise<AuditLogResponseDto[]> {
    const result = await service.findAll({} as QueryAuditLogDto, TENANT_ID);
    return result.data.map(AuditLogResponseDto.fromEntity);
  }

  async function recordUpdateBy(userId: string | null): Promise<void> {
    await service.record({
      tenant_id: TENANT_ID,
      action: AuditAction.UPDATE,
      entity_type: 'Student',
      entity_id: null,
      performed_by_user_id: userId,
      old_values: { full_name: 'Old Name' },
      new_values: { full_name: 'New Name' },
      ip_address: null,
      user_agent: null,
    });
  }

  it('returns the acting user’s name alongside the row', async () => {
    await recordUpdateBy(ACTIVE_USER_ID);

    const rows = await listAsDtos();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.performed_by_name).toBe('Fatema Begum');
  });

  // The reason `withDeleted()` is on the query. Users are soft-deleted,
  // not removed, so without it TypeORM adds `performed_by.deleted_at IS
  // NULL` to the join and a departed administrator's every action is
  // rendered as system-triggered — the audit trail forgetting who acted
  // the moment they leave the school.
  it('still names a user who has since been soft-deleted', async () => {
    await recordUpdateBy(REMOVED_USER_ID);
    await dataSource.getRepository(User).softDelete(REMOVED_USER_ID);

    const rows = await listAsDtos();

    expect(rows).toHaveLength(1);
    expect(rows[0]?.performed_by_name).toBe('Kamrul Hasan');
  });

  it('leaves performed_by_name null for a system-triggered action', async () => {
    await recordUpdateBy(null);

    const rows = await listAsDtos();

    expect(rows[0]?.performed_by_name).toBeNull();
  });

  // Widening the query with `withDeleted()` must not widen the *response*:
  // the join selects two columns, and no credential or contact column may
  // ride along with the name.
  it('does not leak the rest of the user row into the response', async () => {
    await recordUpdateBy(ACTIVE_USER_ID);

    const result = await service.findAll({} as QueryAuditLogDto, TENANT_ID);

    // The joined relation carries only what was selected, so even the
    // pre-DTO entity has no credential or contact column on it.
    expect(JSON.stringify(result.data[0])).not.toContain('active@example.com');
    expect(result.data[0]?.performed_by).toEqual({
      id: ACTIVE_USER_ID,
      full_name: 'Fatema Begum',
    });
    // And the shape the controller actually returns drops the relation
    // entirely, keeping only the flattened name.
    const [row] = result.data.map(AuditLogResponseDto.fromEntity);
    expect(row).not.toHaveProperty('performed_by');
  });

  // Tenant isolation: the join must not become a way around the tenant
  // filter every other audit query depends on.
  it('never returns another tenant’s rows', async () => {
    const otherTenantId = '00000000-0000-4000-8000-0000000003a4';
    const schoolRepo = dataSource.getRepository(School);
    await schoolRepo.save(
      schoolRepo.create({ id: otherTenantId, name: 'Other School', slug: 'audit-int-other' }),
    );
    await auditLogRepo.save(
      auditLogRepo.create({
        tenant_id: otherTenantId,
        action: AuditAction.UPDATE,
        entity_type: 'Student',
        performed_by_user_id: ACTIVE_USER_ID,
      }),
    );

    const result = await service.findAll({} as QueryAuditLogDto, TENANT_ID);

    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });
});
