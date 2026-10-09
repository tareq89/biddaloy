import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditAction, ExamKind, FeeType, UserRole } from '@biddaloy/shared';

import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';
import { AcrAssessment } from '../acr/entities/acr-assessment.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { Exam } from '../exams/entities/exam.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { UserTenant } from '../auth/entities/user-tenant.entity';
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
    return result.data.map((r) => AuditLogResponseDto.fromEntity(r));
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
    const [row] = result.data.map((r) => AuditLogResponseDto.fromEntity(r));
    expect(row).not.toHaveProperty('performed_by');
  });

  // [8.14.9] entity_id filter — exact UUID match, must combine with the
  // existing withDeleted()+leftJoin without breaking either.
  it('filters to rows about one entity_id and still resolves the acting user’s name', async () => {
    const targetEntityId = '00000000-0000-4000-8000-0000000003b1';
    await service.record({
      tenant_id: TENANT_ID,
      action: AuditAction.UPDATE,
      entity_type: 'Student',
      entity_id: targetEntityId,
      performed_by_user_id: ACTIVE_USER_ID,
      old_values: null,
      new_values: null,
      ip_address: null,
      user_agent: null,
    });
    // A second row for a different entity must not show up.
    await recordUpdateBy(ACTIVE_USER_ID);

    const result = await service.findAll(
      { entity_id: targetEntityId } as QueryAuditLogDto,
      TENANT_ID,
    );

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.entity_id).toBe(targetEntityId);
    expect(AuditLogResponseDto.fromEntity(result.data[0]!).performed_by_name).toBe('Fatema Begum');
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

  it('hides AcrAssessment rows about the caller from findAll and findByEntity (ACR privacy)', async () => {
    const YEAR = '00000000-0000-4000-8000-0000000003b1';
    const acrRepo = dataSource.getRepository(AcrAssessment);
    const mine = await acrRepo.save(
      acrRepo.create({
        tenant_id: TENANT_ID,
        user_id: ACTIVE_USER_ID,
        academic_year_id: YEAR,
        form_version_id: YEAR,
        assessed_by: REMOVED_USER_ID,
      }),
    );
    const other = await acrRepo.save(
      acrRepo.create({
        tenant_id: TENANT_ID,
        user_id: REMOVED_USER_ID,
        academic_year_id: YEAR,
        form_version_id: YEAR,
        assessed_by: ACTIVE_USER_ID,
      }),
    );
    for (const a of [mine, other]) {
      await auditLogRepo.save(
        auditLogRepo.create({
          tenant_id: TENANT_ID,
          entity_type: 'AcrAssessment',
          entity_id: a.id,
          action: AuditAction.UPDATE,
          performed_by_user_id: REMOVED_USER_ID,
        }),
      );
    }

    const asSubject = await service.findAll({} as QueryAuditLogDto, TENANT_ID, ACTIVE_USER_ID);
    expect(asSubject.data.map((r) => r.entity_id)).toEqual([other.id]);
    expect(
      (
        await service.findByEntity(
          'AcrAssessment',
          mine.id,
          {} as QueryAuditLogDto,
          TENANT_ID,
          ACTIVE_USER_ID,
        )
      ).total,
    ).toBe(0);

    const asAssessor = await service.findAll({} as QueryAuditLogDto, TENANT_ID, YEAR);
    expect(asAssessor.data.map((r) => r.entity_id).sort()).toEqual([mine.id, other.id].sort());
  });
  describe('entity labels ([31.3.7a])', () => {
    const OTHER_TENANT_ID = '00000000-0000-4000-8000-0000000003c0';
    let studentId: string;
    let deletedStudentId: string;
    let otherTenantStudentId: string;
    let invoiceId: string;
    let invoiceNumber: string;
    let memberUserId: string;
    let outsiderUserId: string;

    let sectionLabel: { id: string; label: string };

    async function seedStudent(tenantId: string, name: string, n: number): Promise<string> {
      // academic_years / classes survive the per-test wipe, so names must be unique per call
      const suffix = Math.random().toString(36).slice(2, 8);
      const dsRepo = dataSource.getRepository(AcademicYear);
      const year = await dsRepo.save(
        dsRepo.create({
          name: `Y${n}-${suffix}`,
          start_date: new Date('2030-01-01'),
          end_date: new Date('2030-12-31'),
          tenant_id: tenantId,
        }),
      );
      const classRepo = dataSource.getRepository(Class);
      const klass = await classRepo.save(
        classRepo.create({
          name: `Class ${n}-${suffix}`,
          academic_year_id: year.id,
          tenant_id: tenantId,
        }),
      );
      const secRepo = dataSource.getRepository(ClassSection);
      const section = await secRepo.save(
        secRepo.create({ class_id: klass.id, section_name: 'A', tenant_id: tenantId }),
      );
      if (n === 1) sectionLabel = { id: section.id, label: `${klass.name} – A` };
      const stuRepo = dataSource.getRepository(Student);
      const student = await stuRepo.save(
        stuRepo.create({
          full_name: name,
          registration_number: `REG-${n}`,
          roll_number: n,
          class_section_id: section.id,
          tenant_id: tenantId,
        }),
      );
      return student.id;
    }

    async function labelsFor(entityType: string, entityId: string, tenantId = TENANT_ID) {
      await auditLogRepo.save(
        auditLogRepo.create({
          tenant_id: tenantId,
          action: AuditAction.UPDATE,
          entity_type: entityType,
          entity_id: entityId,
        }),
      );
      const { entityLabels } = await service.findAll({} as QueryAuditLogDto, tenantId);
      return entityLabels.get(`${entityType}:${entityId}`);
    }

    // Transactional tables (students, invoices, ...) are wiped before every
    // test by the global setup, so the fixtures are re-seeded per test.
    beforeEach(async () => {
      const schoolRepo = dataSource.getRepository(School);
      await schoolRepo.save(
        schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Label Other', slug: 'audit-label-other' }),
      );
      studentId = await seedStudent(TENANT_ID, 'Rahim Uddin', 1);
      deletedStudentId = await seedStudent(TENANT_ID, 'Deleted Dina', 2);
      await dataSource.getRepository(Student).softDelete(deletedStudentId);
      otherTenantStudentId = await seedStudent(OTHER_TENANT_ID, 'Other Tenant Oli', 3);

      const invRepo = dataSource.getRepository(Invoice);
      const inv = await invRepo.save(
        invRepo.create({
          invoice_number: (invoiceNumber = `INV-LABEL-${Math.random().toString(36).slice(2, 8)}`),
          student_id: studentId,
          total_amount: 100,
          issued_date: new Date('2030-01-01'),
          due_date: new Date('2030-01-31'),
          snapshot: {} as never,
        }),
      );
      invoiceId = inv.id;

      const userRepo = dataSource.getRepository(User);
      memberUserId = '00000000-0000-4000-8000-0000000003c1';
      outsiderUserId = '00000000-0000-4000-8000-0000000003c2';
      await userRepo.save([
        userRepo.create({
          id: memberUserId,
          email: 'member@example.com',
          password_hash: 'x',
          full_name: 'Member Mina',
        }),
        userRepo.create({
          id: outsiderUserId,
          email: 'outsider@example.com',
          password_hash: 'x',
          full_name: 'Outsider Omar',
        }),
      ]);
      const utRepo = dataSource.getRepository(UserTenant);
      await utRepo
        .createQueryBuilder()
        .insert()
        .values({ user_id: memberUserId, tenant_id: TENANT_ID, role: UserRole.ADMIN })
        .orIgnore()
        .execute();
    }, 60000);

    it('labels a Student by full_name', async () => {
      expect(await labelsFor('Student', studentId)).toBe('Rahim Uddin');
    });

    it('still labels a soft-deleted student', async () => {
      expect(await labelsFor('Student', deletedStudentId)).toBe('Deleted Dina');
    });

    it('gives no label to a tenant-B student referenced from a tenant-A audit row', async () => {
      expect(await labelsFor('Student', otherTenantStudentId)).toBeUndefined();
    });

    it('labels a User only when the user belongs to the tenant', async () => {
      expect(await labelsFor('User', memberUserId)).toBe('Member Mina');
      expect(await labelsFor('User', outsiderUserId)).toBeUndefined();
    });

    it('labels an Invoice with its invoice_number', async () => {
      expect(await labelsFor('Invoice', invoiceId)).toBe(invoiceNumber);
    });

    it('labels a ClassSection as "Class – Section"', async () => {
      expect(await labelsFor('ClassSection', sectionLabel.id)).toBe(sectionLabel.label);
    });

    it('gives no label to a ClassSection whose class belongs to another tenant', async () => {
      const suffix = Math.random().toString(36).slice(2, 8);
      const yearRepo = dataSource.getRepository(AcademicYear);
      const otherYear = await yearRepo.save(
        yearRepo.create({
          name: `Y-other-${suffix}`,
          start_date: new Date('2030-01-01'),
          end_date: new Date('2030-12-31'),
          tenant_id: OTHER_TENANT_ID,
        }),
      );
      const classRepo = dataSource.getRepository(Class);
      const otherClass = await classRepo.save(
        classRepo.create({
          name: `Secret Class ${suffix}`,
          academic_year_id: otherYear.id,
          tenant_id: OTHER_TENANT_ID,
        }),
      );
      const secRepo = dataSource.getRepository(ClassSection);
      const crossSection = await secRepo.save(
        secRepo.create({ class_id: otherClass.id, section_name: 'Z', tenant_id: TENANT_ID }),
      );
      expect(await labelsFor('ClassSection', crossSection.id)).toBeUndefined();
    });

    it('gives no label to an invoice of a tenant-B student', async () => {
      const invRepo = dataSource.getRepository(Invoice);
      const other = await invRepo.save(
        invRepo.create({
          invoice_number: `INV-OTHER-${Math.random().toString(36).slice(2, 8)}`,
          student_id: otherTenantStudentId,
          total_amount: 100,
          issued_date: new Date('2030-01-01'),
          due_date: new Date('2030-01-31'),
          snapshot: {} as never,
        }),
      );
      expect(await labelsFor('Invoice', other.id)).toBeUndefined();
    });

    it('labels a Guardian, Class, Exam and FeeStructure by name', async () => {
      const [sec] = await dataSource.query(
        `SELECT cs.class_id, c.name AS class_name, c.academic_year_id
           FROM class_sections cs JOIN classes c ON c.id = cs.class_id WHERE cs.id = $1`,
        [sectionLabel.id],
      );
      const guardian = await dataSource
        .getRepository(Guardian)
        .save(
          dataSource
            .getRepository(Guardian)
            .create({ full_name: 'Karim Guardian', relationship: 'FATHER', tenant_id: TENANT_ID }),
        );
      const exam = await dataSource.getRepository(Exam).save(
        dataSource.getRepository(Exam).create({
          tenant_id: TENANT_ID,
          academic_year_id: sec.academic_year_id,
          class_id: sec.class_id,
          name: 'Half Yearly',
          kind: ExamKind.TERM,
        }),
      );
      const fee = await dataSource.getRepository(FeeStructure).save(
        dataSource.getRepository(FeeStructure).create({
          tenant_id: TENANT_ID,
          academic_year_id: sec.academic_year_id,
          fee_type: FeeType.MONTHLY_TUITION,
          name: 'Tuition Fee',
          amount: 500,
        }),
      );
      expect(await labelsFor('Guardian', guardian.id)).toBe('Karim Guardian');
      expect(await labelsFor('Class', sec.class_id)).toBe(sec.class_name);
      expect(await labelsFor('Exam', exam.id)).toBe('Half Yearly');
      expect(await labelsFor('FeeStructure', fee.id)).toBe('Tuition Fee');
    });

    it('gives no label to an unknown entity type', async () => {
      expect(await labelsFor('AcrFormVersion', studentId)).toBeUndefined();
    });
  });
});
