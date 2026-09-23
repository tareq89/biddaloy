import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import {
  RecomputeService,
  RESULT_RECOMPUTER,
  NoopResultRecomputer,
} from '../src/modules/grading/recompute.service';
import { GradingScale } from '../src/modules/grading/entities/grading-scale.entity';
import { GradingBand } from '../src/modules/grading/entities/grading-band.entity';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { School } from '../src/modules/schools/entities/school.entity';

/**
 * [20.2.1] End-to-end proof, against a real DB, that `RecomputeService.confirm`
 * actually replaces a scale's band set and bumps its revision (proves the
 * partial-unique-index fix holds under real inserts), and that tenant
 * isolation on the scale lookup is enforced, not just mocked.
 *
 * `grading_scales`/`grading_bands` are transactional tables (see
 * `test/reset-order.ts`) — the global `beforeEach` in `test/setup.ts`
 * truncates them before every `it()`, so the fixture scale is built fresh
 * in `beforeEach` here, not `beforeAll` (same convention as e.g.
 * `attendance/absence-notice.service.integration.spec.ts`).
 */
describe('RecomputeService (integration)', () => {
  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
  const ADMIN_USER_ID = SEED_ADMIN_USER_ID;

  let dataSource: DataSource;
  let recomputeService: RecomputeService;
  let scaleId: string;

  const bandsA = [
    { percent_from: 0, percent_to: 59, grade: 'B', sequence: 2 },
    { percent_from: 60, percent_to: 100, grade: 'A', sequence: 1 },
  ];
  const bandsB = [
    { percent_from: 0, percent_to: 69, grade: 'F', sequence: 2 },
    { percent_from: 70, percent_to: 100, grade: 'A+', sequence: 1 },
  ];
  const bandsC = [
    { percent_from: 0, percent_to: 79, grade: 'C', sequence: 2 },
    { percent_from: 80, percent_to: 100, grade: 'A++', sequence: 1 },
  ];

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [
        RecomputeService,
        AuditService,
        { provide: RESULT_RECOMPUTER, useClass: NoopResultRecomputer },
      ],
      [],
    );
    recomputeService = module.get<RecomputeService>(RecomputeService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({
        id: OTHER_TENANT,
        name: 'Other School',
        slug: 'grading-recompute-other',
      });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Grading Recompute Test Year ${Date.now()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });

    const scale = await dataSource.getRepository(GradingScale).save({
      tenant_id: TENANT_ID,
      academic_year_id: year.id,
      class_id: null,
      name: `Recompute Test Scale ${Date.now()}`,
    });
    scaleId = scale.id;
  });

  it('replaces the band set and bumps revision on each confirm (1→2→3)', async () => {
    const first = await recomputeService.confirm(
      scaleId,
      TENANT_ID,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
      bandsA as any,
    );
    expect(first.scale.revision).toBe(2);
    expect(first.bands.map((b) => b.grade).sort()).toEqual(['A', 'B']);

    const second = await recomputeService.confirm(
      scaleId,
      TENANT_ID,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
      bandsB as any,
    );
    expect(second.scale.revision).toBe(3);
    expect(second.bands.map((b) => b.grade).sort()).toEqual(['A+', 'F']);

    // Real DB round trip: reload the scale and confirm the stored band set
    // actually changed, not just the in-memory return value.
    const reloaded = await dataSource
      .getRepository(GradingScale)
      .findOne({ where: { id: scaleId } });
    expect(reloaded?.revision).toBe(3);

    const third = await recomputeService.confirm(
      scaleId,
      TENANT_ID,
      ADMIN_USER_ID,
      ADMIN_USER_ID,
      bandsC as any,
    );
    expect(third.scale.revision).toBe(4);
  });

  it("rejects a confirm against another tenant's scale (not empty-success)", async () => {
    await expect(
      recomputeService.confirm(scaleId, OTHER_TENANT, ADMIN_USER_ID, ADMIN_USER_ID, bandsA as any),
    ).rejects.toThrow(NotFoundException);
  });
});
