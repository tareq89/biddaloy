import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_ACADEMIC_YEAR_ID,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { ChangeRequestState } from '@biddaloy/shared';
import { RoutinesModule } from './routines.module';
import { AuthModule } from '../auth/auth.module';
import { AuditService } from '../audit/audit.service';
import { ChangeRequestsService } from './change-requests.service';
import { RoutineChangeRequest } from './entities/routine-change-request.entity';
import { seedPeriodRoutine } from '../attendance/attendance-periods.fixture';

/**
 * [#960] Resolution and its audit row commit in one transaction: a failing
 * audit write must roll the resolution back, leaving the request OPEN.
 */
describe('ChangeRequestsService.resolve (integration)', () => {
  let service: ChangeRequestsService;
  let audit: AuditService;
  let ds: DataSource;
  const CONTEXT = { ip: null, userAgent: null };

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), RoutinesModule, AuthModule],
    );
    service = module.get(ChangeRequestsService);
    audit = module.get(AuditService, { strict: false });
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (ds) await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query(`DELETE FROM routine_change_requests WHERE tenant_id = $1`, [SEED_TENANT_ID]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function openRequest() {
    const { slots } = await seedPeriodRoutine(ds, {
      tenantId: SEED_TENANT_ID,
      academicYearId: SEED_ACADEMIC_YEAR_ID,
      sectionId: SEED_SECTION_1_ID,
      date: '2026-03-04',
      periods: 1,
      createdBy: SEED_ADMIN_USER_ID,
    });
    return service.open(
      slots[0].routineSlot.id,
      { note: 'please move' },
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
  }

  const reload = (id: string) => ds.getRepository(RoutineChangeRequest).findOneByOrFail({ id });
  const resolve = (id: string) =>
    service.resolve(
      id,
      { state: ChangeRequestState.ACCEPTED, resolution_note: 'ok' },
      SEED_TENANT_ID,
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

  it('rolls the resolution back when the audit write fails', async () => {
    const request = await openRequest();
    vi.spyOn(audit, 'record').mockRejectedValueOnce(new Error('audit down'));

    await expect(resolve(request.id)).rejects.toThrow('audit down');

    const after = await reload(request.id);
    expect(after.state).toBe(ChangeRequestState.OPEN);
    expect(after.resolved_by).toBeNull();
    expect(after.resolved_at).toBeNull();
  });

  it('persists the resolution and its audit row together, and refuses a second resolve', async () => {
    const request = await openRequest();

    await resolve(request.id);

    expect((await reload(request.id)).state).toBe(ChangeRequestState.ACCEPTED);
    const rows = await ds.query(
      `SELECT new_values FROM audit_logs WHERE entity_type = 'RoutineChangeRequest' AND entity_id = $1`,
      [request.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].new_values.state).toBe(ChangeRequestState.ACCEPTED);
    await expect(resolve(request.id)).rejects.toThrow(/already resolved/);
  });
});
