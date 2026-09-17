import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { DiscountRulesService } from './discount-rules.service';
import { AuditService } from '../audit/audit.service';
import { DiscountRule } from './entities/discount-rule.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { Student } from '../students/entities/student.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_CLASS_1_ID,
  SEED_SECTION_1_ID,
  SEED_ACADEMIC_YEAR_ID,
} from '@test/constants';
import { DiscountKind, EnrollmentStatus, FeeType, UserStatus } from '@biddaloy/shared';

/**
 * Integration tests for `DiscountRulesService` (#677/16.7.3) — the
 * `DiscountResolver` `FeeGenerationService` calls at generation time, plus
 * its CRUD.
 */
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000199';
const STUDENT_ID = '00000000-0000-4000-8000-000000000501';
const OTHER_STUDENT_ID = '00000000-0000-4000-8000-000000000502';
const TUITION_STRUCTURE_ID = '00000000-0000-4000-8000-000000000551';
const LATE_FEE_STRUCTURE_ID = '00000000-0000-4000-8000-000000000552';
const OTHER_TENANT_STRUCTURE_ID = '00000000-0000-4000-8000-000000000553';
const OTHER_ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000198';
const APPROVER_ID = '00000000-0000-4000-8000-000000000999';
const TODAY_PERIOD = '2026-03-01';

describe('DiscountRulesService (integration)', () => {
  let ds: DataSource;
  let service: DiscountRulesService;
  let ruleRepo: Repository<DiscountRule>;
  let studentRepo: Repository<Student>;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [DiscountRulesService, AuditService]);
    ds = module.get(DataSource);
    service = module.get(DiscountRulesService);
    ruleRepo = ds.getRepository(DiscountRule);
    studentRepo = ds.getRepository(Student);

    const schoolRepo = ds.getRepository(School);
    const ayRepo = ds.getRepository(AcademicYear);
    const classRepo = ds.getRepository(Class);
    const sectionRepo = ds.getRepository(ClassSection);

    await schoolRepo.save(
      schoolRepo.create({ id: SEED_TENANT_ID, name: 'Test School', slug: 'test-school' }),
    );
    await schoolRepo.save(
      schoolRepo.create({ id: OTHER_TENANT_ID, name: 'Other School', slug: 'other-school' }),
    );
    await ayRepo.save(
      ayRepo.create({
        id: SEED_ACADEMIC_YEAR_ID,
        name: '2026-2027',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await ayRepo.save(
      ayRepo.create({
        id: OTHER_ACADEMIC_YEAR_ID,
        name: '2026-2027',
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-12-31'),
        tenant_id: OTHER_TENANT_ID,
      }),
    );
    await classRepo.save(
      classRepo.create({
        id: SEED_CLASS_1_ID,
        name: 'Class 1',
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await sectionRepo.save(
      sectionRepo.create({
        id: SEED_SECTION_1_ID,
        section_name: 'Section A',
        class_id: SEED_CLASS_1_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  // `students`/`fee_structures`/`discount_rules` are all in
  // `TRANSACTIONAL_TABLES_CHILD_FIRST` (`test/reset-order.ts`) — the global
  // `beforeEach` (`test/setup.ts`) truncates them before every test, so
  // this file's own fixtures need reseeding every test too, not just once
  // in `beforeAll` (same convention `fee-dues.service.integration.spec.ts`
  // documents for `fee_structures`).
  beforeEach(async () => {
    // `discount_rules.approved_by_user_id` has a real FK to `users` — the
    // approver on every `service.create`/`update` call below must exist.
    // `users` is truncated per-test too, so reseed here, not `beforeAll`.
    await ds.getRepository(User).save(
      ds.getRepository(User).create({
        id: APPROVER_ID,
        full_name: 'Test Approver',
        status: UserStatus.ACTIVE,
      }),
    );

    const feeStructureRepo = ds.getRepository(FeeStructure);
    await feeStructureRepo.save(
      feeStructureRepo.create({
        id: TUITION_STRUCTURE_ID,
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition Fee',
        amount: 1000,
        class_id: SEED_CLASS_1_ID,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await feeStructureRepo.save(
      feeStructureRepo.create({
        id: LATE_FEE_STRUCTURE_ID,
        fee_type: FeeType.LATE_FEE,
        name: 'Late fee',
        amount: 1,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    // [CodeRabbit review, PR #801] a valid, non-late fee structure that
    // genuinely belongs to OTHER_TENANT_ID — the tenant-isolation test
    // below resolves against this instead of TUITION_STRUCTURE_ID (which
    // belongs to SEED_TENANT_ID), so the tenant-scoped structure lookup
    // succeeds and the test actually exercises the discount-rule query's
    // own tenant_id filter, instead of returning 0 early via "structure
    // not found in this tenant".
    await feeStructureRepo.save(
      feeStructureRepo.create({
        id: OTHER_TENANT_STRUCTURE_ID,
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Other Tenant Tuition Fee',
        amount: 1000,
        academic_year_id: OTHER_ACADEMIC_YEAR_ID,
        tenant_id: OTHER_TENANT_ID,
      }),
    );

    await studentRepo.save(
      studentRepo.create({
        id: STUDENT_ID,
        full_name: 'Disc Ount',
        registration_number: 'REG-501',
        tenant_id: SEED_TENANT_ID,
        class_section_id: SEED_SECTION_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        roll_number: 501,
      }),
    );
    await studentRepo.save(
      studentRepo.create({
        id: OTHER_STUDENT_ID,
        full_name: 'Other Kid',
        registration_number: 'REG-502',
        tenant_id: OTHER_TENANT_ID,
        class_section_id: SEED_SECTION_1_ID,
        enrollment_status: EnrollmentStatus.ACTIVE,
        roll_number: 502,
      }),
    );
  });

  describe('CRUD', () => {
    it('creates, updates, and soft-deletes a rule', async () => {
      const created = await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.PERCENT,
        value: 20,
        reason: 'Sibling discount',
      });
      expect(created.id).toBeDefined();
      expect(created.approved_by_user_id).toBe(APPROVER_ID);
      expect(created.is_active).toBe(true);

      const updated = await service.update(SEED_TENANT_ID, created.id, APPROVER_ID, APPROVER_ID, {
        value: 25,
      });
      expect(Number(updated.value)).toBe(25);

      await service.remove(SEED_TENANT_ID, created.id, APPROVER_ID, APPROVER_ID);
      const found = await ruleRepo.findOne({ where: { id: created.id } });
      expect(found).toBeNull(); // soft-deleted, excluded by default find
    });

    it('tenant-isolated: a rule for one tenant is invisible to another', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 100,
        reason: 'Test',
      });
      const otherTenantRules = await service.listForStudent(OTHER_TENANT_ID, STUDENT_ID);
      expect(otherTenantRules).toHaveLength(0);
    });

    it('[CodeRabbit review, PR #801] refuses to create a rule against a student from a different tenant', async () => {
      // OTHER_STUDENT_ID genuinely exists, just under OTHER_TENANT_ID —
      // this is the "valid student, wrong tenant" case the review flagged,
      // not a not-found id.
      await expect(
        service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
          student_id: OTHER_STUDENT_ID,
          kind: DiscountKind.FLAT,
          value: 50,
          reason: 'Should be refused',
        }),
      ).rejects.toThrow('Student not found in this tenant');
    });

    it('[CodeRabbit review, PR #801] refuses a reversed active window on create', async () => {
      await expect(
        service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
          student_id: STUDENT_ID,
          kind: DiscountKind.FLAT,
          value: 50,
          starts_on: '2026-06-01',
          ends_on: '2026-01-01', // before starts_on
          reason: 'Reversed window',
        }),
      ).rejects.toThrow('starts_on must not be after ends_on');
    });

    it('[CodeRabbit review, PR #801] refuses a PATCH that reverses an existing valid window', async () => {
      const created = await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 50,
        starts_on: '2026-01-01',
        ends_on: '2026-06-01',
        reason: 'Valid window',
      });

      // Only ends_on is patched, but the merged state (starts_on from the
      // existing row) is now reversed.
      await expect(
        service.update(SEED_TENANT_ID, created.id, APPROVER_ID, APPROVER_ID, {
          ends_on: '2025-01-01',
        }),
      ).rejects.toThrow('starts_on must not be after ends_on');
    });

    it('[Opus review B3] a deactivated rule (is_active: false) no longer resolves', async () => {
      const created = await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 100,
        reason: 'Test',
      });
      await service.update(SEED_TENANT_ID, created.id, APPROVER_ID, APPROVER_ID, {
        is_active: false,
      });

      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
      });
      expect(result.amount).toBe(0);
    });
  });

  describe('resolve (DiscountResolver)', () => {
    it('PERCENT rounds half-up to 2 decimals', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.PERCENT,
        value: 12.35,
        reason: 'Test',
      });
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 333,
        periodStart: TODAY_PERIOD,
      });
      // 12.35% of 333 = 41.1255 -> half-up to 41.13
      expect(result.amount).toBe(41.13);
    });

    it('[CodeRabbit review, PR #801] rounds a half-cent value correctly despite binary-float representation error', async () => {
      // 1% of 100.5 = 1.005 exactly, in decimal. In IEEE 754 binary
      // floating point, `1.005 * 100` is actually `100.49999999999999`, so
      // a naive `Math.round(value * 100) / 100` rounds this DOWN to 1
      // instead of the documented half-up result 1.01.
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.PERCENT,
        value: 1,
        reason: 'Half-cent precision test',
      });
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 100.5,
        periodStart: TODAY_PERIOD,
      });
      expect(result.amount).toBe(1.01);
    });

    it('largest discount wins when FLAT and PERCENT both apply', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 50,
        reason: 'Flat',
      });
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.PERCENT,
        value: 10,
        reason: 'Percent',
      });
      // 10% of 1000 = 100 > flat 50
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
      });
      expect(result.amount).toBe(100);
    });

    it('fee_types null matches every fee type', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 30,
        reason: 'All fee types',
      });
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
      });
      expect(result.amount).toBe(30);
    });

    it('fee_types scoping: a rule for a different fee type does not apply', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 30,
        fee_types: [FeeType.EXAM_FEE],
        reason: 'Exam only',
      });
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID, // MONTHLY_TUITION
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
      });
      expect(result.amount).toBe(0);
    });

    it('never discounts a LATE_FEE-type bill, even with a fee_types:null rule', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.PERCENT,
        value: 100,
        reason: 'Everything',
      });
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: LATE_FEE_STRUCTURE_ID,
        baseAmount: 500,
        periodStart: TODAY_PERIOD,
      });
      expect(result.amount).toBe(0);
    });

    it('respects starts_on/ends_on expiry against periodStart, not today', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 40,
        starts_on: '2000-01-01',
        ends_on: '2000-12-31', // long expired relative to *today*
        reason: 'Expired',
      });
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD, // 2026, well after the rule's window too
      });
      expect(result.amount).toBe(0);
    });

    it('[Opus review B5] a back-dated generation evaluates the rule live for periodStart, not for today', async () => {
      // Rule was only ever live for January 2026.
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 40,
        starts_on: '2026-01-01',
        ends_on: '2026-01-31',
        reason: 'January-only discount',
      });

      // Generating January's bill (even though "today" is March) must
      // still see the rule as live.
      const januaryResult = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: '2026-01-15',
      });
      expect(januaryResult.amount).toBe(40);

      // Generating March's bill must NOT see the (already-expired-for-
      // that-period) rule.
      const marchResult = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: '2026-03-15',
      });
      expect(marchResult.amount).toBe(0);
    });

    it('[Opus review B2] a FLAT discount larger than the bill is capped at the bill amount', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 5000, // way over the 1000 bill
        reason: 'Oversized FLAT rule',
      });
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
      });
      expect(result.amount).toBe(1000); // capped, never negative-billed
    });

    it("never resolves against another tenant's student", async () => {
      // A real rule exists for STUDENT_ID under SEED_TENANT_ID.
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 999,
        reason: 'Should not leak',
      });
      // Resolving with tenantId: OTHER_TENANT_ID but the *same* STUDENT_ID
      // and a fee structure that genuinely belongs to OTHER_TENANT_ID: the
      // structure lookup succeeds (so this doesn't short-circuit via
      // "structure not found"), which means the only thing that can stop
      // the 999 rule above from leaking through is the discount-rule
      // query's own tenant_id filter.
      const result = await service.resolve({
        tenantId: OTHER_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: OTHER_TENANT_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
      });
      expect(result.amount).toBe(0);
    });
  });

  describe('[CodeRabbit review, PR #801] batched resolution', () => {
    it('preloadRulesForStudents() returns a map whose per-student slice lets resolve() skip its own query', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 100,
        reason: 'Batched',
      });

      const preloaded = await service.preloadRulesForStudents(SEED_TENANT_ID, [STUDENT_ID]);
      expect(preloaded.get(STUDENT_ID)).toHaveLength(1);

      const findSpy = vi.spyOn(ruleRepo, 'find');
      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
        feeType: FeeType.MONTHLY_TUITION,
        preloadedRules: preloaded.get(STUDENT_ID),
      });

      expect(result.amount).toBe(100);
      // The preload already ran the one query for this student — resolve()
      // must not query the rules table again when the caller passes the
      // preloaded slice through explicitly.
      expect(findSpy).not.toHaveBeenCalled();
      findSpy.mockRestore();
    });

    it('a student outside the preloaded set still resolves correctly via the unbatched fallback', async () => {
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 100,
        reason: 'Not preloaded',
      });

      // Preload for a *different* student only.
      const preloaded = await service.preloadRulesForStudents(SEED_TENANT_ID, [OTHER_STUDENT_ID]);

      const result = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
        // STUDENT_ID has no slice in `preloaded` — resolve() must fall
        // back to its own query rather than treating "no entry" as "no
        // rules apply".
        preloadedRules: preloaded.get(STUDENT_ID),
      });

      expect(result.amount).toBe(100);
    });

    it("[CodeRabbit review, PR #801] two concurrent preloads never see each other's rules", async () => {
      // The whole point of not caching on `this`: two callers preloading
      // for different students at "the same time" (interleaved awaits)
      // must each still resolve only against their own preloaded slice.
      const SECOND_STUDENT_ID = '00000000-0000-4000-8000-000000000504';
      await studentRepo.save(
        studentRepo.create({
          id: SECOND_STUDENT_ID,
          full_name: 'Second Student',
          registration_number: 'REG-504',
          tenant_id: SEED_TENANT_ID,
          class_section_id: SEED_SECTION_1_ID,
          enrollment_status: EnrollmentStatus.ACTIVE,
          roll_number: 504,
        }),
      );
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 100,
        reason: 'Batch A',
      });
      await service.create(SEED_TENANT_ID, APPROVER_ID, APPROVER_ID, {
        student_id: SECOND_STUDENT_ID,
        kind: DiscountKind.FLAT,
        value: 999,
        reason: 'Batch B',
      });

      const [preloadedA] = await Promise.all([
        service.preloadRulesForStudents(SEED_TENANT_ID, [STUDENT_ID]),
        service.preloadRulesForStudents(SEED_TENANT_ID, [SECOND_STUDENT_ID]),
      ]);

      const resultA = await service.resolve({
        tenantId: SEED_TENANT_ID,
        studentId: STUDENT_ID,
        feeStructureId: TUITION_STRUCTURE_ID,
        baseAmount: 1000,
        periodStart: TODAY_PERIOD,
        preloadedRules: preloadedA.get(STUDENT_ID),
      });
      expect(resultA.amount).toBe(100); // never picks up SECOND_STUDENT_ID's 999
    });
  });
});
