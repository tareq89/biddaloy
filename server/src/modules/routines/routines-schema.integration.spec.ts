import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Subject } from '../academics/entities/subject.entity';
import { User } from '../users/entities/user.entity';
import { Shift } from './entities/shift.entity';
import { PeriodSlot } from './entities/period-slot.entity';
import { Room } from './entities/room.entity';
import { Routine } from './entities/routine.entity';
import { RoutineSlot } from './entities/routine-slot.entity';
import { RoutineSubstitution } from './entities/routine-substitution.entity';
import { PeriodSlotKind, RoutineState, SlotRecurrence } from '@biddaloy/shared';

/**
 * [21.2.1] Schema-level coverage for the routines domain: the constraints
 * a service layer would otherwise hide behind a friendly exception. There
 * is no service yet (this ticket is entity-only — see
 * `routines.module.ts`), so these tests go straight at the repositories,
 * the same layer `1789800011000-AddRoutines` operates at.
 *
 * Like `classes.service.integration.spec.ts`, this module runs with
 * `synchronize: true, dropSchema: true` — TypeORM builds the schema from
 * entity metadata, not migrations. Two constraints the entity `@Index`/
 * `@Column` decorators cannot express (`rooms`' `NULLS NOT DISTINCT`
 * unique index, `period_slots`'/`routine_slots`' `CHECK` constraints) are
 * therefore added by hand below, copied verbatim from the migration, so
 * they're actually enforced under test.
 */
describe('Routines schema (constraints, shift promotion, tenant isolation)', () => {
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [], [], {
      synchronize: true,
      dropSchema: true,
    });
    dataSource = module.get<DataSource>(getDataSourceToken());

    // Copied from `1789800011000-AddRoutines`'s `up()` — decorators can't
    // express these, so the migration is their source of truth and this
    // recreates them by hand for the synchronize-built test schema.
    await dataSource.query(
      `ALTER TABLE "period_slots" ADD CONSTRAINT "CHK_period_slots_time_range" CHECK ("starts_at" < "ends_at")`,
    );
    await dataSource.query(
      `ALTER TABLE "routine_slots" ADD CONSTRAINT "CHK_routine_slots_weekday" CHECK ("weekday" BETWEEN 0 AND 6)`,
    );
    await dataSource.query(
      `ALTER TABLE "routine_slots" ADD CONSTRAINT "CHK_routine_slots_valid_range" CHECK ("valid_to" IS NULL OR "valid_from" <= "valid_to")`,
    );
    await dataSource.query(
      `ALTER TABLE "shifts" ADD CONSTRAINT "CHK_shifts_time_range" CHECK ("day_starts_at" < "day_ends_at")`,
    );
    await dataSource.query(`
      CREATE UNIQUE INDEX "UQ_rooms_tenant_building_room_no" ON "rooms" ("tenant_id", "building", "room_no")
      NULLS NOT DISTINCT WHERE "deleted_at" IS NULL
    `);

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: TENANT_ID } }))) {
      await schoolRepo.save({ id: TENANT_ID, name: 'Test School', slug: 'test-school' });
    }
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }
  }, 60000);

  afterAll(async () => {
    await dataSource.destroy();
  });

  beforeEach(async () => {
    // FK-safe cleanup order — children before parents.
    await dataSource.query('DELETE FROM routine_change_requests');
    await dataSource.query('DELETE FROM routine_substitutions');
    await dataSource.query('DELETE FROM routine_slot_teachers');
    await dataSource.query('DELETE FROM routine_slots');
    await dataSource.query('DELETE FROM routines');
    await dataSource.query('DELETE FROM rooms');
    await dataSource.query('DELETE FROM period_slots');
    // `classes.shift_id` FK is ON DELETE SET NULL (see `Class`'s and
    // `Shift`'s docstrings), so deleting `shifts` rows first is safe.
    await dataSource.query('DELETE FROM shifts');
    await dataSource.query('DELETE FROM class_sections');
    await dataSource.query('DELETE FROM classes');
    await dataSource.query('DELETE FROM subjects');
    await dataSource.query('DELETE FROM academic_years');
    await dataSource.query('DELETE FROM users');
  });

  async function createYear(tenantId = TENANT_ID) {
    return dataSource.getRepository(AcademicYear).save({
      name: '2026-2027',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: tenantId,
    });
  }

  async function createSubject(tenantId = TENANT_ID) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    return dataSource.getRepository(Subject).save({
      name_en: `Subject-${code}`,
      code,
      tenant_id: tenantId,
    });
  }

  async function createShift(tenantId = TENANT_ID) {
    return dataSource.getRepository(Shift).save({
      name: `Shift-${Math.random().toString(36).slice(2, 8)}`,
      day_starts_at: '08:00:00',
      day_ends_at: '13:00:00',
      sequence: 0,
      tenant_id: tenantId,
    });
  }

  async function createUser() {
    return dataSource.getRepository(User).save({
      full_name: 'Routine Coordinator',
      email: `coordinator-${Math.random().toString(36).slice(2, 8)}@test.com`,
    });
  }

  describe('shift promotion (Epic 33.0 D10 — Step 3 of the migration)', () => {
    // These three statements are the exact SQL from
    // `1789800011000-AddRoutines`'s `up()`. There's no service to drive
    // this through — the migration itself is the only thing that runs
    // it — so the test re-executes that SQL verbatim against seeded
    // `classes` rows, rather than re-running the (already-applied, by
    // `synchronize: true`) migration class.
    async function promoteShifts() {
      await dataSource.query(`
        INSERT INTO "shifts" ("tenant_id", "name", "day_starts_at", "day_ends_at", "sequence")
        SELECT DISTINCT "tenant_id", "shift", '08:00:00'::time, '13:00:00'::time, 0::smallint
        FROM "classes"
        WHERE "shift" IS NOT NULL
      `);
      await dataSource.query(`
        UPDATE "classes" c
        SET "shift_id" = s."id"
        FROM "shifts" s
        WHERE c."tenant_id" = s."tenant_id" AND c."shift" = s."name"
      `);
    }

    it('collapses two classes with the same shift name into one shifts row, backfilling shift_id on both', async () => {
      const year = await createYear();
      const classRepo = dataSource.getRepository(Class);
      const classA = await classRepo.save({
        name: 'Class 6',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
        shift: 'Morning',
      });
      const classB = await classRepo.save({
        name: 'Class 7',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
        shift: 'Morning',
      });

      await promoteShifts();

      const shifts = await dataSource
        .getRepository(Shift)
        .find({ where: { tenant_id: TENANT_ID, name: 'Morning' } });
      expect(shifts).toHaveLength(1);

      const [reloadedA, reloadedB] = await Promise.all([
        classRepo.findOneOrFail({ where: { id: classA.id } }),
        classRepo.findOneOrFail({ where: { id: classB.id } }),
      ]);
      expect(reloadedA.shift_id).toBe(shifts[0].id);
      expect(reloadedB.shift_id).toBe(shifts[0].id);
    });

    it('leaves shift_id null for a class with no shift set', async () => {
      const year = await createYear();
      const classRepo = dataSource.getRepository(Class);
      const noShiftClass = await classRepo.save({
        name: 'Class 8',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
        shift: null,
      });

      await promoteShifts();

      const reloaded = await classRepo.findOneOrFail({ where: { id: noShiftClass.id } });
      expect(reloaded.shift_id).toBeNull();
    });

    it('does not cross-link two tenants that both use a shift named the same', async () => {
      // The promotion UPDATE joins on (tenant_id, name), not name alone —
      // this is the highest-risk line in the migration for a money-tier
      // tenant-scoped ticket, so it gets its own test rather than relying
      // on the two same-tenant cases above to imply it.
      const yearA = await createYear(TENANT_ID);
      const yearB = await createYear(OTHER_TENANT);
      const classRepo = dataSource.getRepository(Class);
      const classA = await classRepo.save({
        name: 'Class 6',
        academic_year_id: yearA.id,
        tenant_id: TENANT_ID,
        shift: 'Morning',
      });
      const classB = await classRepo.save({
        name: 'Class 6',
        academic_year_id: yearB.id,
        tenant_id: OTHER_TENANT,
        shift: 'Morning',
      });

      await promoteShifts();

      const shiftRepo = dataSource.getRepository(Shift);
      const tenantAShifts = await shiftRepo.find({
        where: { tenant_id: TENANT_ID, name: 'Morning' },
      });
      const tenantBShifts = await shiftRepo.find({
        where: { tenant_id: OTHER_TENANT, name: 'Morning' },
      });
      expect(tenantAShifts).toHaveLength(1);
      expect(tenantBShifts).toHaveLength(1);
      expect(tenantAShifts[0].id).not.toBe(tenantBShifts[0].id);

      const [reloadedA, reloadedB] = await Promise.all([
        classRepo.findOneOrFail({ where: { id: classA.id } }),
        classRepo.findOneOrFail({ where: { id: classB.id } }),
      ]);
      expect(reloadedA.shift_id).toBe(tenantAShifts[0].id);
      expect(reloadedB.shift_id).toBe(tenantBShifts[0].id);
    });
  });

  describe('period_slots constraints', () => {
    it('rejects a period slot whose starts_at is not before ends_at', async () => {
      const shift = await createShift();
      await expect(
        dataSource.getRepository(PeriodSlot).save({
          tenant_id: TENANT_ID,
          shift_id: shift.id,
          sequence: 1,
          kind: PeriodSlotKind.CLASS,
          name: null,
          starts_at: '09:00:00',
          ends_at: '09:00:00',
        }),
      ).rejects.toThrow();
    });

    it('rejects a second period slot with the same (shift_id, sequence)', async () => {
      const shift = await createShift();
      const periodSlotRepo = dataSource.getRepository(PeriodSlot);
      await periodSlotRepo.save({
        tenant_id: TENANT_ID,
        shift_id: shift.id,
        sequence: 1,
        kind: PeriodSlotKind.CLASS,
        name: null,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      });

      await expect(
        periodSlotRepo.save({
          tenant_id: TENANT_ID,
          shift_id: shift.id,
          sequence: 1,
          kind: PeriodSlotKind.CLASS,
          name: null,
          starts_at: '08:40:00',
          ends_at: '09:20:00',
        }),
      ).rejects.toThrow();
    });
  });

  describe('rooms constraint', () => {
    it('rejects a second room with the same (tenant_id, room_no) when building is NULL on both (NULLS NOT DISTINCT)', async () => {
      const roomRepo = dataSource.getRepository(Room);
      await roomRepo.save({
        tenant_id: TENANT_ID,
        building: null,
        room_no: '204',
        capacity: 30,
      });

      await expect(
        roomRepo.save({
          tenant_id: TENANT_ID,
          building: null,
          room_no: '204',
          capacity: 40,
        }),
      ).rejects.toThrow();
    });

    it('allows two rooms with the same room_no when their buildings differ', async () => {
      const roomRepo = dataSource.getRepository(Room);
      await roomRepo.save({ tenant_id: TENANT_ID, building: 'A', room_no: '204', capacity: 30 });

      await expect(
        roomRepo.save({ tenant_id: TENANT_ID, building: 'B', room_no: '204', capacity: 30 }),
      ).resolves.toBeDefined();
    });
  });

  describe('routine_substitutions constraint', () => {
    async function createRoutineSlotFixture() {
      const year = await createYear();
      const shift = await createShift();
      const periodSlot = await dataSource.getRepository(PeriodSlot).save({
        tenant_id: TENANT_ID,
        shift_id: shift.id,
        sequence: 1,
        kind: PeriodSlotKind.CLASS,
        name: null,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      });
      const klass = await dataSource.getRepository(Class).save({
        name: 'Class 6',
        academic_year_id: year.id,
        tenant_id: TENANT_ID,
      });
      const section = await dataSource.getRepository(ClassSection).save({
        class_id: klass.id,
        section_name: 'A',
        tenant_id: TENANT_ID,
      });
      const subject = await createSubject();
      const routine = await dataSource.getRepository(Routine).save({
        tenant_id: TENANT_ID,
        academic_year_id: year.id,
        name: 'Main Routine',
        state: RoutineState.DRAFT,
      });
      const routineSlot = await dataSource.getRepository(RoutineSlot).save({
        tenant_id: TENANT_ID,
        routine_id: routine.id,
        section_id: section.id,
        period_slot_id: periodSlot.id,
        weekday: 0,
        subject_id: subject.id,
        recurrence: SlotRecurrence.WEEKLY,
        valid_from: '2026-01-01',
      });
      const user = await createUser();
      return { routineSlot, user };
    }

    it('rejects a second substitution for the same (routine_slot_id, date)', async () => {
      const { routineSlot, user } = await createRoutineSlotFixture();
      const substitutionRepo = dataSource.getRepository(RoutineSubstitution);
      await substitutionRepo.save({
        tenant_id: TENANT_ID,
        routine_slot_id: routineSlot.id,
        date: '2026-02-01',
        is_cancelled: true,
        created_by: user.id,
      });

      await expect(
        substitutionRepo.save({
          tenant_id: TENANT_ID,
          routine_slot_id: routineSlot.id,
          date: '2026-02-01',
          is_cancelled: false,
          created_by: user.id,
        }),
      ).rejects.toThrow();
    });
  });

  describe('tenant isolation', () => {
    it('creating a routine for one tenant leaves another tenant with none', async () => {
      const yearA = await createYear(TENANT_ID);
      await dataSource.getRepository(Routine).save({
        tenant_id: TENANT_ID,
        academic_year_id: yearA.id,
        name: 'Tenant A Routine',
        state: RoutineState.DRAFT,
      });

      const otherTenantRoutines = await dataSource
        .getRepository(Routine)
        .find({ where: { tenant_id: OTHER_TENANT } });
      expect(otherTenantRoutines).toHaveLength(0);

      const tenantARoutines = await dataSource
        .getRepository(Routine)
        .find({ where: { tenant_id: TENANT_ID } });
      expect(tenantARoutines).toHaveLength(1);
    });
  });
});
