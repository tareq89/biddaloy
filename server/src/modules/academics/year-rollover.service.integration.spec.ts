import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import {
  AuditAction,
  TeacherAssignmentType,
  UserStatus,
  YEAR_ROLLOVER_BLOCKS,
} from '@biddaloy/shared';
import { YearRolloverService } from './year-rollover.service';
import { FeeStructureService } from '../fees/fees.service';
import { GradingService } from '../grading/grading.service';
import { AcademicTermsService } from '../calendar/academic-terms.service';
import { AuditService } from '../audit/audit.service';
import { AcademicYear } from './entities/academic-year.entity';
import { Class } from './entities/class.entity';
import { ClassSection } from './entities/class-section.entity';
import { ClassSubject } from './entities/class-subject.entity';
import { Subject } from './entities/subject.entity';
import { Teacher } from './entities/teacher.entity';
import { TeacherClassSection } from './entities/teacher-class-section.entity';
import { AcademicTerm } from '../calendar/entities/academic-term.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

/** [69.2.01] Year rollover on a real DB: all-or-nothing, idempotent, names skipped staff. */
describe('YearRolloverService (integration)', () => {
  let service: YearRolloverService;
  let terms: AcademicTermsService;
  let ds: DataSource;
  const TENANT = SEED_TENANT_ID;
  const OTHER = '00000000-0000-4000-8000-000000000097';
  let sfx = '';
  const input = (name: string) => ({
    name,
    start_date: '2028-01-01',
    end_date: '2028-12-31',
    include: [...YEAR_ROLLOVER_BLOCKS],
  });
  let sourceId: string;

  const count = (entity: any, where: object) => ds.getRepository(entity).count({ where });

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      YearRolloverService,
      FeeStructureService,
      GradingService,
      AcademicTermsService,
      AuditService,
    ]);
    service = module.get(YearRolloverService);
    terms = module.get(AcademicTermsService);
    ds = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  // The global per-test reset empties the tables, so each test seeds its own source year.
  beforeEach(async () => {
    sfx = randomUUID().slice(0, 8);
    const schools = ds.getRepository(School);
    if (!(await schools.findOne({ where: { id: OTHER } }))) {
      await schools.save({ id: OTHER, name: 'Other', slug: `other-roll-${sfx}` } as any);
    }
    const year = await ds.getRepository(AcademicYear).save({
      name: `src-${sfx}`,
      start_date: '2027-01-01' as any,
      end_date: '2027-12-31' as any,
      tenant_id: TENANT,
    });
    sourceId = year.id;
    const subject = await ds.getRepository(Subject).save({
      tenant_id: TENANT,
      name_en: `Maths ${sfx}`,
      code: `M${sfx}`,
    } as any);
    const makeTeacher = async (tag: string, status: UserStatus) => {
      const user = await ds.getRepository(User).save({
        full_name: `T ${tag} ${sfx}`,
        email: `${tag}-${sfx}@example.test`,
        status,
      } as any);
      await ds.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at) VALUES ($1,$2,'TEACHER',now(),now())`,
        [user.id, TENANT],
      );
      const teacher = await ds.getRepository(Teacher).save({
        user_id: user.id,
        employee_id: `E-${tag}-${sfx}`,
        tenant_id: TENANT,
      } as any);
      return { user, teacher };
    };
    const active = await makeTeacher('act', UserStatus.ACTIVE);
    const suspended = await makeTeacher('sus', UserStatus.SUSPENDED);
    for (const n of ['One', 'Two', 'Three']) {
      const cls = await ds.getRepository(Class).save({
        name: `${n} ${sfx}`,
        academic_year_id: sourceId,
        tenant_id: TENANT,
      } as any);
      const sec = await ds.getRepository(ClassSection).save({
        class_id: cls.id,
        section_name: 'A',
        capacity: 40,
        tenant_id: TENANT,
      } as any);
      await ds.getRepository(ClassSubject).save({
        class_id: cls.id,
        subject_id: subject.id,
        academic_year_id: sourceId,
        tenant_id: TENANT,
      } as any);
      for (const t of [active.teacher, suspended.teacher]) {
        await ds.getRepository(TeacherClassSection).save({
          teacher_id: t.id,
          section_id: sec.id,
          subject_id: subject.id,
          assignment_type: TeacherAssignmentType.SUBJECT_TEACHER,
          tenant_id: TENANT,
        } as any);
      }
    }
    await ds.getRepository(AcademicTerm).save({
      tenant_id: TENANT,
      academic_year_id: sourceId,
      seq: 1,
      name: 'Term 1',
      start_date: '2027-01-01',
      end_date: '2027-06-30',
    } as any);
  }, 60000);

  afterAll(async () => {
    await ds?.destroy();
  });

  it('preview writes nothing', async () => {
    const before = await count(Class, { tenant_id: TENANT });
    const res = await service.preview(TENANT, sourceId, input(`prev-${sfx}`));
    expect(res.target_year_id).toBeNull();
    expect(res.classes?.created).toBe(3);
    expect(await count(Class, { tenant_id: TENANT })).toBe(before);
    expect(await count(AcademicYear, { name: `prev-${sfx}` })).toBe(0);
  });

  it('copies a 3-class year, names skipped staff, and a re-run duplicates nothing', async () => {
    const name = `tgt-${sfx}`;
    const first = await service.create(TENANT, SEED_ADMIN_USER_ID, sourceId, input(name));
    expect(first.classes).toMatchObject({ created: 3, existing: 0 });
    expect(first.sections).toMatchObject({ created: 3 });
    expect(first.class_subjects).toMatchObject({ created: 3 });
    expect(first.teacher_assignments).toMatchObject({ created: 3 });
    // The suspended teacher is skipped, once per section.
    expect(first.skipped_staff).toHaveLength(3);
    expect(first.skipped_staff[0].teacher_name).toContain('sus');
    expect(first.terms?.created).toBe(1);
    const tid = first.target_year_id!;
    const rows = async () => [
      await count(Class, { academic_year_id: tid }),
      await count(ClassSubject, { academic_year_id: tid }),
      await count(AcademicTerm, { academic_year_id: tid }),
    ];
    expect(await rows()).toEqual([3, 3, 1]);

    const second = await service.create(TENANT, SEED_ADMIN_USER_ID, sourceId, input(name));
    expect(second.target_year_id).toBe(tid);
    expect(second.classes).toMatchObject({ created: 0, existing: 3 });
    expect(second.sections).toMatchObject({ created: 0, existing: 3 });
    expect(second.teacher_assignments).toMatchObject({ created: 0, existing: 3 });
    expect(second.terms).toMatchObject({ created: 0, existing: 1 });
    expect(await rows()).toEqual([3, 3, 1]);

    expect(
      await count(AuditLog, { action: AuditAction.YEAR_ROLLOVER, entity_id: tid }),
    ).toBeGreaterThanOrEqual(1);
  });

  it('rolls everything back when a later block fails', async () => {
    const name = `fail-${sfx}`;
    const spy = vi.spyOn(terms, 'copyTermsToYear').mockRejectedValueOnce(new Error('boom'));
    await expect(service.create(TENANT, SEED_ADMIN_USER_ID, sourceId, input(name))).rejects.toThrow(
      'boom',
    );
    spy.mockRestore();
    // The target year created in the same transaction is gone too.
    expect(await count(AcademicYear, { name })).toBe(0);
  });

  it("404s for another tenant's source year", async () => {
    await expect(
      service.create(OTHER, SEED_ADMIN_USER_ID, sourceId, input(`x-${sfx}`)),
    ).rejects.toThrow(NotFoundException);
  });

  it('honours include: classes only copies no sections', async () => {
    const res = await service.create(TENANT, SEED_ADMIN_USER_ID, sourceId, {
      ...input(`inc-${sfx}`),
      include: ['classes'],
    });
    expect(res.classes?.created).toBe(3);
    expect(res.sections).toBeUndefined();
    expect(res.terms).toBeUndefined();
  });
});
