import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConflictException, ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DataSource, Repository } from 'typeorm';
import { TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PublicExamType, UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { SEED_TENANT_ID, SEED_SECTION_1_ID } from '@test/constants';
import { AuditService } from '../audit/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { RolesGuard } from '../auth/guards/context.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { StudentPublicExamsService } from './student-public-exams.service';
import { StudentPublicExamsController } from './student-public-exams.controller';
import { Student } from './entities/student.entity';

const TENANT_B = '39000000-0000-4000-8000-0000000000b1';
const USER = '39000000-0000-4000-8000-0000000000c1';

const body = (exam_type: PublicExamType = PublicExamType.SSC) => ({
  exam_type,
  board: 'Dhaka',
  roll_no: '1',
  registration_no: '2',
  gpa: 4.5,
  passing_year: 2020,
});

describe('StudentPublicExamsService (integration)', () => {
  let moduleRef: TestingModule;
  let service: StudentPublicExamsService;
  let ds: DataSource;
  let studentRepo: Repository<Student>;
  let student: Student;

  beforeAll(async () => {
    moduleRef = await createTestModule(ALL_ENTITIES, [StudentPublicExamsService, AuditService]);
    service = moduleRef.get(StudentPublicExamsService);
    ds = moduleRef.get(DataSource);
    studentRepo = moduleRef.get(getRepositoryToken(Student));
  }, 60000);

  // test/setup.ts wipes transactional tables before every test, so seed per test.
  beforeEach(async () => {
    await ds.query(
      `INSERT INTO schools (id, name, slug) VALUES ($1, 'PE B', 'pe-b') ON CONFLICT DO NOTHING`,
      [TENANT_B],
    );
    await ds.query(
      `INSERT INTO users (id, email, password_hash, full_name, status)
       VALUES ($1, 'pe-user@test.example', 'x', 'PE User', 'ACTIVE') ON CONFLICT DO NOTHING`,
      [USER],
    );
    student = await studentRepo.save(
      studentRepo.create({
        full_name: 'PE Student',
        registration_number: `PE-${Date.now()}`,
        roll_number: 9001,
        class_section_id: SEED_SECTION_1_ID,
        tenant_id: SEED_TENANT_ID,
      } as Partial<Student>),
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM student_public_exams WHERE student_id = $1`, [student.id]);
    await ds.query(`DELETE FROM audit_logs WHERE performed_by_user_id = $1`, [USER]);
    await ds.query(`DELETE FROM students WHERE id = $1`, [student.id]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [USER]);
    await ds.query(`DELETE FROM schools WHERE id = $1`, [TENANT_B]);
    await moduleRef.close();
  });

  it('creates, lists, updates, audits, and rejects a duplicate type', async () => {
    const row = await service.create(student.id, body() as any, SEED_TENANT_ID, USER);
    expect(row.gpa).toBe('4.50');
    await expect(
      service.create(student.id, body() as any, SEED_TENANT_ID, USER),
    ).rejects.toBeInstanceOf(ConflictException);

    await service.create(student.id, body(PublicExamType.HSC) as any, SEED_TENANT_ID, USER);
    const updated = await service.update(student.id, row.id, { gpa: 3.25 }, SEED_TENANT_ID, USER);
    expect(updated.gpa).toBe('3.25');

    const list = await service.list(student.id, SEED_TENANT_ID);
    expect(list.map((r) => r.exam_type).sort()).toEqual(['HSC', 'SSC']);

    const audits = await ds
      .getRepository(AuditLog)
      .find({ where: { performed_by_user_id: USER, entity_id: student.id } });
    expect(audits.map((a) => a.action).sort()).toEqual(['CREATE', 'CREATE', 'UPDATE']);
  });

  it('concurrent creates of the same type yield exactly one row', async () => {
    const results = await Promise.allSettled([
      service.create(student.id, body(PublicExamType.JSC) as any, SEED_TENANT_ID, USER),
      service.create(student.id, body(PublicExamType.JSC) as any, SEED_TENANT_ID, USER),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('soft delete then re-adding the same type succeeds', async () => {
    const row = await service.create(
      student.id,
      body(PublicExamType.PSC) as any,
      SEED_TENANT_ID,
      USER,
    );
    await service.remove(student.id, row.id, SEED_TENANT_ID, USER);
    expect((await service.list(student.id, SEED_TENANT_ID)).map((r) => r.id)).not.toContain(row.id);
    await expect(
      service.create(student.id, body(PublicExamType.PSC) as any, SEED_TENANT_ID, USER),
    ).resolves.toBeDefined();
  });

  it('is tenant-isolated on every operation', async () => {
    const row = await service.create(
      student.id,
      body(PublicExamType.DAKHIL) as any,
      SEED_TENANT_ID,
      USER,
    );
    await expect(service.list(student.id, TENANT_B)).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.create(student.id, body(PublicExamType.ALIM) as any, TENANT_B, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.update(student.id, row.id, { board: 'X' }, TENANT_B, USER),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.remove(student.id, row.id, TENANT_B, USER)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('D22 route guards (real RolesGuard + PermissionsGuard on the controller)', () => {
    const reflector = new Reflector();
    const rolesGuard = new RolesGuard(reflector);
    const permsGuard = new PermissionsGuard(reflector);
    const proto = StudentPublicExamsController.prototype;

    const allowed = (handler: (...a: any[]) => unknown, role: UserRole) => {
      const ctx = {
        getHandler: () => handler,
        getClass: () => StudentPublicExamsController,
        switchToHttp: () => ({ getRequest: () => ({ currentTenant: { role } }) }),
      } as unknown as ExecutionContext;
      try {
        return rolesGuard.canActivate(ctx) && permsGuard.canActivate(ctx);
      } catch {
        return false;
      }
    };

    it('TEACHER can read but not create/update/delete', () => {
      expect(allowed(proto.list, UserRole.TEACHER)).toBe(true);
      for (const h of [proto.create, proto.update, proto.remove]) {
        expect(allowed(h, UserRole.TEACHER)).toBe(false);
      }
    });

    it('ADMIN and EXECUTIVE can write; ACCOUNTANT cannot even read', () => {
      for (const role of [UserRole.ADMIN, UserRole.EXECUTIVE]) {
        expect(allowed(proto.create, role)).toBe(true);
      }
      expect(allowed(proto.list, UserRole.ACCOUNTANT)).toBe(false);
    });
  });
});
