import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AuditService } from '../audit/audit.service';
import { WalletService } from '../fees/wallet.service';
import { GuardianService } from './students.service';
import { StudentsDashboardService } from './students-dashboard.service';

/**
 * [8.10.7.4.13] Guardians-incomplete and students-added-today widgets. Counts
 * only; the guardian count must equal the list total behind its link (D33).
 */
describe('StudentsDashboardService (integration)', () => {
  let service: StudentsDashboardService;
  let guardians: GuardianService;
  let ds: DataSource;
  const TENANT = SEED_TENANT_ID;
  const OTHER = '00000000-0000-4000-8000-000000000098';
  const sections: Record<string, string> = {};
  let n = 0;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [StudentsDashboardService, GuardianService, AuditService, WalletService],
      [],
      { synchronize: true, dropSchema: true },
    );
    service = module.get(StudentsDashboardService);
    guardians = module.get(GuardianService);
    ds = module.get(DataSource);

    for (const [i, tenant] of [TENANT, OTHER].entries()) {
      await ds
        .getRepository(School)
        .save({ id: tenant, name: `S${i}`, slug: `dash-s${i}`, tenant_id: tenant });
      const year = await ds.getRepository(AcademicYear).save({
        name: `Y${i}`,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        is_current: true,
        tenant_id: tenant,
      });
      const klass = await ds
        .getRepository(Class)
        .save({ name: `C${i}`, academic_year_id: year.id, tenant_id: tenant });
      const section = await ds
        .getRepository(ClassSection)
        .save({ section_name: 'A', class_id: klass.id, tenant_id: tenant });
      sections[tenant] = section.id;
    }
  }, 60000);

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM student_guardians');
    await ds.query('DELETE FROM guardians');
    await ds.query('DELETE FROM students');
  });

  afterEach(() => vi.useRealTimers());

  async function guardian(
    tenant: string,
    o: Partial<{
      full_name: string;
      relationship: string;
      phone: string | null;
      alternate_phone: string | null;
      deleted: boolean;
    }> = {},
  ) {
    n += 1;
    await ds.query(
      `INSERT INTO guardians (full_name, relationship, phone, alternate_phone, tenant_id, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        o.full_name ?? `Guardian ${n}`,
        o.relationship ?? 'Father',
        o.phone === undefined ? '01711000000' : o.phone,
        o.alternate_phone ?? null,
        tenant,
        o.deleted ? new Date() : null,
      ],
    );
  }

  async function student(tenant: string, createdAt: string, deleted = false) {
    n += 1;
    await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, created_at, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        `Kid ${n}`,
        `DASH-${n}`,
        n,
        sections[tenant],
        tenant,
        createdAt,
        deleted ? new Date() : null,
      ],
    );
  }

  describe('getGuardiansIncomplete', () => {
    it('counts blank name / relationship / both phones; ignores soft-deleted', async () => {
      await guardian(TENANT, { full_name: '   ' }); // incomplete
      await guardian(TENANT, { relationship: '  ' }); // incomplete
      await guardian(TENANT, { phone: null, alternate_phone: ' ' }); // incomplete
      await guardian(TENANT, { phone: null, alternate_phone: '01811000000' }); // complete
      await guardian(TENANT, { relationship: 'Other' }); // complete
      await guardian(TENANT, { full_name: '', deleted: true }); // ignored
      expect(await service.getGuardiansIncomplete(TENANT)).toEqual({
        incomplete_count: 3,
        total_count: 5,
      });
    });

    it('equals GuardianService.findAll({ incomplete: true }).total', async () => {
      await guardian(TENANT, { full_name: '' });
      await guardian(TENANT, { phone: null });
      await guardian(TENANT);
      const { incomplete_count } = await service.getGuardiansIncomplete(TENANT);
      const list = await guardians.findAll({ incomplete: true } as never, TENANT);
      expect(incomplete_count).toBe(2);
      expect(list.total).toBe(incomplete_count);
    });

    it('is tenant isolated', async () => {
      await guardian(OTHER, { full_name: '' });
      await guardian(OTHER);
      await guardian(TENANT);
      expect(await service.getGuardiansIncomplete(TENANT)).toEqual({
        incomplete_count: 0,
        total_count: 1,
      });
    });
  });

  describe('getStudentsAddedToday', () => {
    it('counts only the Dhaka day; soft-deleted excluded', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-07T06:00:00Z')); // noon Dhaka
      await student(TENANT, '2026-10-06T17:50:00Z'); // 23:50 Dhaka yesterday
      await student(TENANT, '2026-10-06T18:10:00Z'); // 00:10 Dhaka today
      await student(TENANT, '2026-10-07T06:00:00Z'); // noon today
      await student(TENANT, '2026-10-07T06:00:00Z', true); // deleted
      expect(await service.getStudentsAddedToday(TENANT)).toEqual({
        added_today: 2,
        as_of: '2026-10-07',
      });
    });

    it('Dhaka midnight boundary', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-06T18:30:00Z')); // 00:30 on 7 Oct Dhaka
      await student(TENANT, '2026-10-06T18:10:00Z');
      await student(TENANT, '2026-10-06T17:50:00Z');
      expect(await service.getStudentsAddedToday(TENANT)).toEqual({
        added_today: 1,
        as_of: '2026-10-07',
      });
    });

    it('is tenant isolated', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-07T06:00:00Z'));
      await student(OTHER, '2026-10-07T05:00:00Z');
      expect((await service.getStudentsAddedToday(TENANT)).added_today).toBe(0);
    });
  });
});
