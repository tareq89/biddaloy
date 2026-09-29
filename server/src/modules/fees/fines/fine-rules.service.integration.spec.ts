import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FineRulesService } from './fine-rules.service';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { FineRule } from '../entities/fine-rule.entity';
import { FeeStructure } from '../entities/fee-structure.entity';
import { Class } from '../../academics/entities/class.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_CLASS_1_ID, SEED_ACADEMIC_YEAR_ID } from '@test/constants';
import { FeeType, FineTrigger, UserStatus } from '@biddaloy/shared';

/**
 * Integration tests for `FineRulesService` (#1113/38.2.1) — CRUD, the
 * per-trigger `conditions` validation (D6), the duplicate-active unique
 * constraint (D22), and copy-from-last-year.
 */
const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000199';
const OTHER_ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000198';
const TARGET_ACADEMIC_YEAR_ID = '00000000-0000-4000-8000-000000000197';
const TARGET_CLASS_1_ID = '00000000-0000-4000-8000-000000000196';
const FINE_STRUCTURE_ID = '00000000-0000-4000-8000-000000000651';
const NON_FINE_STRUCTURE_ID = '00000000-0000-4000-8000-000000000652';
const OTHER_TENANT_STRUCTURE_ID = '00000000-0000-4000-8000-000000000653';
const USER_ID = '00000000-0000-4000-8000-000000000999';

describe('FineRulesService (integration)', () => {
  let ds: DataSource;
  let service: FineRulesService;
  let ruleRepo: Repository<FineRule>;
  let feeStructureRepo: Repository<FeeStructure>;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [FineRulesService, AuditService]);
    ds = module.get(DataSource);
    service = module.get(FineRulesService);
    ruleRepo = ds.getRepository(FineRule);
    feeStructureRepo = ds.getRepository(FeeStructure);

    const schoolRepo = ds.getRepository(School);
    const ayRepo = ds.getRepository(AcademicYear);
    const classRepo = ds.getRepository(Class);

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
        id: TARGET_ACADEMIC_YEAR_ID,
        name: '2027-2028',
        start_date: new Date('2027-01-01'),
        end_date: new Date('2027-12-31'),
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
    // `copy()` maps a class by (name, shift, version) into the target year
    // rather than reusing the source year's class id (a Class belongs to
    // exactly one year) — give the target year an equivalent "Class 1" so
    // copy tests can assert the class-scoped rule actually carries over.
    await classRepo.save(
      classRepo.create({
        id: TARGET_CLASS_1_ID,
        name: 'Class 1',
        academic_year_id: TARGET_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
  });

  afterAll(async () => {
    await ds.destroy();
  });

  // `fee_structures`/`fine_rules` are truncated before every test by the
  // global `beforeEach` (`test/setup.ts`) — reseed per test, not once in
  // `beforeAll` (same convention as `discount-rules.service.integration.spec.ts`).
  beforeEach(async () => {
    // `audit_logs.performed_by_user_id` has a real FK to `users` — every
    // `service.create`/`update`/`remove`/`copy` call below writes an audit
    // row as `USER_ID`. `users` is truncated per-test too (same convention
    // as `discount-rules.service.integration.spec.ts`'s `APPROVER_ID`).
    await ds.getRepository(User).save(
      ds.getRepository(User).create({
        id: USER_ID,
        full_name: 'Test User',
        status: UserStatus.ACTIVE,
      }),
    );

    await feeStructureRepo.save(
      feeStructureRepo.create({
        id: FINE_STRUCTURE_ID,
        fee_type: FeeType.FINE,
        name: 'Attendance Fine',
        amount: 20,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await feeStructureRepo.save(
      feeStructureRepo.create({
        id: NON_FINE_STRUCTURE_ID,
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition Fee',
        amount: 1000,
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        tenant_id: SEED_TENANT_ID,
      }),
    );
    await feeStructureRepo.save(
      feeStructureRepo.create({
        id: OTHER_TENANT_STRUCTURE_ID,
        fee_type: FeeType.FINE,
        name: 'Other Tenant Fine',
        amount: 20,
        academic_year_id: OTHER_ACADEMIC_YEAR_ID,
        tenant_id: OTHER_TENANT_ID,
      }),
    );
  });

  describe('create', () => {
    it('creates a default (school-wide) rule and a per-class rule for the same trigger', async () => {
      const defaultRule = await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: FINE_STRUCTURE_ID,
      });
      expect(defaultRule.class_id).toBeNull();
      expect(defaultRule.is_active).toBe(true);

      const classRule = await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: FINE_STRUCTURE_ID,
        class_id: SEED_CLASS_1_ID,
      });
      expect(classRule.class_id).toBe(SEED_CLASS_1_ID);
    });

    it('rejects a duplicate active (year, trigger, class) with 409', async () => {
      await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: FINE_STRUCTURE_ID,
      });
      await expect(
        service.create(SEED_TENANT_ID, USER_ID, {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          trigger: FineTrigger.ATTENDANCE_ABSENT,
          fee_structure_id: FINE_STRUCTURE_ID,
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects a fee_structure_id that is not a FINE structure with 400', async () => {
      await expect(
        service.create(SEED_TENANT_ID, USER_ID, {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          trigger: FineTrigger.ATTENDANCE_ABSENT,
          fee_structure_id: NON_FINE_STRUCTURE_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts ATTENDANCE_LATE with a valid min_minutes_late, rejects an unknown key', async () => {
      const ok = await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_LATE,
        fee_structure_id: FINE_STRUCTURE_ID,
        conditions: { min_minutes_late: 10 },
      });
      expect(ok.conditions).toEqual({ min_minutes_late: 10 });

      await expect(
        service.create(SEED_TENANT_ID, USER_ID, {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          trigger: FineTrigger.ATTENDANCE_LATE,
          fee_structure_id: FINE_STRUCTURE_ID,
          class_id: SEED_CLASS_1_ID,
          conditions: { foo: 1 } as unknown as Record<string, number>,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a class that belongs to a different academic year than the rule', async () => {
      await expect(
        service.create(SEED_TENANT_ID, USER_ID, {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          trigger: FineTrigger.ATTENDANCE_ABSENT,
          fee_structure_id: FINE_STRUCTURE_ID,
          class_id: TARGET_CLASS_1_ID, // belongs to the target year, not the seed year
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('refuses a fee structure that genuinely belongs to another tenant with 404', async () => {
      await expect(
        service.create(SEED_TENANT_ID, USER_ID, {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          trigger: FineTrigger.ATTENDANCE_ABSENT,
          fee_structure_id: OTHER_TENANT_STRUCTURE_ID,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove + re-create', () => {
    it('soft-deleting a rule frees its (year, trigger, class) scope for a new one', async () => {
      const rule = await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: FINE_STRUCTURE_ID,
      });
      await service.remove(SEED_TENANT_ID, rule.id, USER_ID);
      expect(await ruleRepo.findOne({ where: { id: rule.id } })).toBeNull();

      const recreated = await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: FINE_STRUCTURE_ID,
      });
      expect(recreated.id).not.toBe(rule.id);
    });
  });

  describe('copy', () => {
    it('creates structures + rules in the target year, and is idempotent on a second run', async () => {
      await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: FINE_STRUCTURE_ID,
      });
      await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_LATE,
        fee_structure_id: FINE_STRUCTURE_ID,
        class_id: SEED_CLASS_1_ID,
        conditions: { min_minutes_late: 10 },
      });

      const firstRun = await service.copy(SEED_TENANT_ID, USER_ID, {
        from_academic_year_id: SEED_ACADEMIC_YEAR_ID,
        to_academic_year_id: TARGET_ACADEMIC_YEAR_ID,
      });
      expect(firstRun).toEqual({ structures_created: 1, rules_created: 2, skipped: 0 });

      const targetRules = await ruleRepo.find({
        where: { tenant_id: SEED_TENANT_ID, academic_year_id: TARGET_ACADEMIC_YEAR_ID },
      });
      expect(targetRules).toHaveLength(2);
      // The class-scoped rule must point at the TARGET year's "Class 1",
      // not the source year's class id — a Class belongs to one year only.
      const classRule = targetRules.find((r) => r.trigger === FineTrigger.ATTENDANCE_LATE);
      expect(classRule?.class_id).toBe(TARGET_CLASS_1_ID);

      const secondRun = await service.copy(SEED_TENANT_ID, USER_ID, {
        from_academic_year_id: SEED_ACADEMIC_YEAR_ID,
        to_academic_year_id: TARGET_ACADEMIC_YEAR_ID,
      });
      expect(secondRun).toEqual({ structures_created: 0, rules_created: 0, skipped: 2 });
    });

    it('does not copy an inactive rule', async () => {
      const rule = await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: FINE_STRUCTURE_ID,
      });
      await service.update(SEED_TENANT_ID, rule.id, USER_ID, { is_active: false });

      const result = await service.copy(SEED_TENANT_ID, USER_ID, {
        from_academic_year_id: SEED_ACADEMIC_YEAR_ID,
        to_academic_year_id: TARGET_ACADEMIC_YEAR_ID,
      });
      expect(result).toEqual({ structures_created: 1, rules_created: 0, skipped: 0 });
    });

    it('rejects a target academic year belonging to another tenant with 404', async () => {
      await expect(
        service.copy(SEED_TENANT_ID, USER_ID, {
          from_academic_year_id: SEED_ACADEMIC_YEAR_ID,
          to_academic_year_id: OTHER_ACADEMIC_YEAR_ID,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects copying a year onto itself', async () => {
      await expect(
        service.copy(SEED_TENANT_ID, USER_ID, {
          from_academic_year_id: SEED_ACADEMIC_YEAR_ID,
          to_academic_year_id: SEED_ACADEMIC_YEAR_ID,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('audit', () => {
    it('writes an audit row for create, update, delete and copy', async () => {
      const auditRepo = ds.getRepository(AuditLog);

      const rule = await service.create(SEED_TENANT_ID, USER_ID, {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        trigger: FineTrigger.ATTENDANCE_ABSENT,
        fee_structure_id: FINE_STRUCTURE_ID,
      });
      await service.update(SEED_TENANT_ID, rule.id, USER_ID, { free_per_period: 2 });
      await service.remove(SEED_TENANT_ID, rule.id, USER_ID);
      await service.copy(SEED_TENANT_ID, USER_ID, {
        from_academic_year_id: SEED_ACADEMIC_YEAR_ID,
        to_academic_year_id: TARGET_ACADEMIC_YEAR_ID,
      });

      const rows = await auditRepo.find({
        where: { entity_type: 'FineRule', tenant_id: SEED_TENANT_ID },
      });
      expect(rows.map((r) => r.action).sort()).toEqual(
        ['CREATE', 'CREATE', 'DELETE', 'UPDATE'].sort(),
      );
    });
  });
});
