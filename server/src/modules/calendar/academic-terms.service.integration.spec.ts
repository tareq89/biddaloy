import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UnprocessableEntityException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { CalendarModule } from './calendar.module';
import { AuthModule } from '../auth/auth.module';
import { AcademicTermsService } from './academic-terms.service';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { AcademicTerm } from './entities/academic-term.entity';

const CONTEXT = { ip: null, userAgent: null };

/**
 * Integration tests for `AcademicTermsService` (#706/17.2.2) — the
 * database-owned overlap exclusion constraint and the service-owned
 * ordering/range rules, against a real, migrated test database.
 */
describe('AcademicTermsService (integration)', () => {
  let service: AcademicTermsService;
  let dataSource: DataSource;

  const TENANT_A = SEED_TENANT_ID;
  const TENANT_B = '00000000-0000-4000-8000-000000000098';
  let yearAId: string;
  let yearBId: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), CalendarModule, AuthModule],
    );
    service = module.get<AcademicTermsService>(AcademicTermsService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_B } }))) {
      await schoolRepo.save({ id: TENANT_B, name: 'Other School', slug: 'other-school-17-2-2' });
    }

    const yearRepo = dataSource.getRepository(AcademicYear);
    const yearA = await yearRepo.save({
      name: 'Academic Terms Test Year A',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_A,
    });
    yearAId = yearA.id;
    const yearB = await yearRepo.save({
      name: 'Academic Terms Test Year B',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_B,
    });
    yearBId = yearB.id;
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('assigns seq = max(seq) + 1 for the year on create', async () => {
    const t1 = await service.create(
      TENANT_A,
      {
        academic_year_id: yearAId,
        name: 'Term 1',
        start_date: '2026-01-01',
        end_date: '2026-04-30',
      },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );
    expect(t1.seq).toBe(1);

    const t2 = await service.create(
      TENANT_A,
      {
        academic_year_id: yearAId,
        name: 'Term 2',
        start_date: '2026-05-01',
        end_date: '2026-08-31',
      },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );
    expect(t2.seq).toBe(2);
  });

  it('rejects an overlapping term with 422 TERM_OVERLAP', async () => {
    await service.create(
      TENANT_A,
      {
        academic_year_id: yearAId,
        name: 'Overlap Base',
        start_date: '2026-09-01',
        end_date: '2026-09-30',
      },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

    await expect(
      service.create(
        TENANT_A,
        {
          academic_year_id: yearAId,
          name: 'Overlap Attempt',
          start_date: '2026-09-15',
          end_date: '2026-10-15',
        },
        SEED_ADMIN_USER_ID,
        CONTEXT,
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { details: { code: 'TERM_OVERLAP' } },
    });
  });

  it('rejects touching ranges (end = next start) as overlapping — inclusive daterange', async () => {
    const base = await service.create(
      TENANT_A,
      {
        academic_year_id: yearAId,
        name: 'Touch Base',
        start_date: '2026-11-01',
        end_date: '2026-11-15',
      },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

    await expect(
      service.create(
        TENANT_A,
        {
          academic_year_id: yearAId,
          name: 'Touch Attempt',
          start_date: '2026-11-15',
          end_date: '2026-11-20',
        },
        SEED_ADMIN_USER_ID,
        CONTEXT,
      ),
    ).rejects.toMatchObject({
      status: 422,
      response: { details: { code: 'TERM_OVERLAP' } },
    });

    // sanity: the base term itself did save fine
    expect(base.id).toBeTruthy();
  });

  it('rejects a term outside the academic year with 422 TERM_OUTSIDE_ACADEMIC_YEAR', async () => {
    await expect(
      service.create(
        TENANT_A,
        {
          academic_year_id: yearAId,
          name: 'Outside Year',
          start_date: '2025-12-01',
          end_date: '2026-01-15',
        },
        SEED_ADMIN_USER_ID,
        CONTEXT,
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('frees the date range once the occupying term is soft-deleted', async () => {
    const term = await service.create(
      TENANT_B,
      {
        academic_year_id: yearBId,
        name: 'Freeable',
        start_date: '2026-02-01',
        end_date: '2026-02-28',
      },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

    await service.remove(TENANT_B, term.id, SEED_ADMIN_USER_ID, CONTEXT);

    // Same range, previously occupied — now free since the row is soft-deleted
    // (the exclusion constraint is scoped to `deleted_at IS NULL`).
    const replacement = await service.create(
      TENANT_B,
      {
        academic_year_id: yearBId,
        name: 'Replacement',
        start_date: '2026-02-01',
        end_date: '2026-02-28',
      },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );
    expect(replacement.id).toBeTruthy();
  });

  it('resequences remaining terms densely after a delete', async () => {
    const repo = dataSource.getRepository(AcademicTerm);
    const yearRepo = dataSource.getRepository(AcademicYear);
    const year = await yearRepo.save({
      name: 'Resequence Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_B,
    });

    const t1 = await service.create(
      TENANT_B,
      { academic_year_id: year.id, name: 'R1', start_date: '2026-01-01', end_date: '2026-03-31' },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );
    const t2 = await service.create(
      TENANT_B,
      { academic_year_id: year.id, name: 'R2', start_date: '2026-04-01', end_date: '2026-06-30' },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );
    const t3 = await service.create(
      TENANT_B,
      { academic_year_id: year.id, name: 'R3', start_date: '2026-07-01', end_date: '2026-09-30' },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

    await service.remove(TENANT_B, t1.id, SEED_ADMIN_USER_ID, CONTEXT);

    const remaining = await repo.find({
      where: { tenant_id: TENANT_B, academic_year_id: year.id },
      order: { seq: 'ASC' },
    });
    expect(remaining.map((t) => [t.id, t.seq])).toEqual([
      [t2.id, 1],
      [t3.id, 2],
    ]);
  });

  it('rewrites seq densely on reorder', async () => {
    const yearRepo = dataSource.getRepository(AcademicYear);
    const year = await yearRepo.save({
      name: 'Reorder Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_B,
    });

    const t1 = await service.create(
      TENANT_B,
      { academic_year_id: year.id, name: 'O1', start_date: '2026-01-01', end_date: '2026-03-31' },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );
    const t2 = await service.create(
      TENANT_B,
      { academic_year_id: year.id, name: 'O2', start_date: '2026-04-01', end_date: '2026-06-30' },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

    const reordered = await service.reorder(
      TENANT_B,
      year.id,
      [t2.id, t1.id],
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

    expect(reordered.map((t) => t.id)).toEqual([t2.id, t1.id]);
    expect(reordered.map((t) => t.seq)).toEqual([1, 2]);
  });

  it('rejects reorder ids containing a duplicate', async () => {
    const yearRepo = dataSource.getRepository(AcademicYear);
    const year = await yearRepo.save({
      name: 'Duplicate Reorder Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_B,
    });

    const t1 = await service.create(
      TENANT_B,
      { academic_year_id: year.id, name: 'D1', start_date: '2026-01-01', end_date: '2026-03-31' },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );
    await service.create(
      TENANT_B,
      { academic_year_id: year.id, name: 'D2', start_date: '2026-04-01', end_date: '2026-06-30' },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

    // [t1, t1] has the right length (2) to match the year's term count,
    // but is not a permutation of the real ids — must still be rejected,
    // not attempted (which would hit a unique-constraint error instead).
    await expect(
      service.reorder(TENANT_B, year.id, [t1.id, t1.id], SEED_ADMIN_USER_ID, CONTEXT),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('throws NotFoundException updating a term in another tenant', async () => {
    const term = await service.create(
      TENANT_A,
      {
        academic_year_id: yearAId,
        name: 'Cross Tenant',
        start_date: '2026-12-01',
        end_date: '2026-12-31',
      },
      SEED_ADMIN_USER_ID,
      CONTEXT,
    );

    await expect(
      service.update(TENANT_B, term.id, { name: 'Hijacked' }, SEED_ADMIN_USER_ID, CONTEXT),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
