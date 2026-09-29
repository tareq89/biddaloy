import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID } from '@test/constants';
import { FeeModule } from '../fees.module';
import { CalendarModule } from '../../calendar/calendar.module';
import { AuthModule } from '../../auth/auth.module';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { FeeStructure } from '../entities/fee-structure.entity';
import { FineRule } from '../entities/fine-rule.entity';
import { StudentFee } from '../entities/student-fee.entity';
import { FeeGeneration } from '../entities/fee-generation.entity';
import { DiscountRule } from '../entities/discount-rule.entity';
import { AttendanceSession } from '../../attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../../attendance/entities/attendance-record.entity';
import {
  AttendanceSessionState,
  AttendanceStatus,
  DiscountKind,
  DuplicateStrategy,
  FeeGenerationSource,
  FeeType,
  FineTrigger,
} from '@biddaloy/shared';
import { FineSweepService } from './fine-sweep.service';

/**
 * Integration tests for `FineSweepService` — real DB. `FineSweepService`
 * isn't wired into `fees.module.ts` yet (38.2.5's job), so this file adds
 * it as an extra provider alongside `FeesModule`/`CalendarModule` rather
 * than relying on either module to export it.
 */
describe('FineSweepService (integration)', () => {
  let service: FineSweepService;
  let dataSource: DataSource;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [FineSweepService],
      [ConfigModule.forRoot({ isGlobal: true }), FeeModule, CalendarModule, AuthModule],
    );
    service = module.get<FineSweepService>(FineSweepService);
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  /** A fresh tenant + academic year + class + section, isolated per test so
   * `FineRule`'s (tenant, year, trigger, class) uniqueness never collides
   * across tests. */
  async function setupTenant(yearStart: string, yearEnd: string) {
    const school = await dataSource
      .getRepository(School)
      .save({
        name: `Fine Sweep Test ${Date.now()}-${Math.random()}`,
        slug: `fine-sweep-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        settings: { version: 1, attendance: { weeklyOffDays: [] } } as any,
      });
    const year = await dataSource.getRepository(AcademicYear).save({
      name: 'Fine Sweep Test Year',
      start_date: yearStart,
      end_date: yearEnd,
      tenant_id: school.id,
    });
    const klass = await dataSource
      .getRepository(Class)
      .save({ name: 'Fine Sweep Class', academic_year_id: year.id, tenant_id: school.id });
    const section = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'Fine Sweep Section', class_id: klass.id, tenant_id: school.id });
    return { tenantId: school.id, yearId: year.id, classId: klass.id, sectionId: section.id };
  }

  async function makeStudent(tenantId: string, sectionId: string, label: string): Promise<string> {
    const student = await dataSource.getRepository(Student).save({
      full_name: `Fine Sweep Student ${label}`,
      registration_number: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      roll_number: Math.floor(Math.random() * 100000),
      class_section_id: sectionId,
      tenant_id: tenantId,
    });
    return student.id;
  }

  async function makeStructure(tenantId: string, yearId: string, amount: number): Promise<string> {
    const structure = await dataSource.getRepository(FeeStructure).save({
      tenant_id: tenantId,
      academic_year_id: yearId,
      fee_type: FeeType.FINE,
      name: 'Attendance fine',
      amount,
    });
    return structure.id;
  }

  async function markAbsences(
    tenantId: string,
    sectionId: string,
    studentId: string,
    dates: string[],
  ): Promise<void> {
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    const recordRepo = dataSource.getRepository(AttendanceRecord);
    for (const date of dates) {
      let session = await sessionRepo.findOne({
        where: { tenant_id: tenantId, section_id: sectionId, date, period_no: IsNull() },
      });
      if (!session) {
        session = await sessionRepo.save({
          tenant_id: tenantId,
          section_id: sectionId,
          date,
          period_no: null,
          state: AttendanceSessionState.FINALIZED,
        });
      }
      await recordRepo.save({
        tenant_id: tenantId,
        session_id: session.id,
        student_id: studentId,
        date,
        status: AttendanceStatus.ABSENT,
      });
    }
  }

  async function makeRule(input: {
    tenantId: string;
    yearId: string;
    classId?: string | null;
    structureId: string;
    freePerPeriod?: number;
    capPerPeriod?: number | null;
    trigger?: FineTrigger;
    conditions?: Record<string, string | number | boolean | null>;
  }): Promise<string> {
    const rule = await dataSource.getRepository(FineRule).save({
      tenant_id: input.tenantId,
      academic_year_id: input.yearId,
      trigger: input.trigger ?? FineTrigger.ATTENDANCE_ABSENT,
      fee_structure_id: input.structureId,
      class_id: input.classId ?? null,
      free_per_period: input.freePerPeriod ?? 0,
      cap_per_period: input.capPerPeriod ?? null,
      conditions: input.conditions ?? {},
      is_active: true,
    });
    return rule.id;
  }

  async function markLate(
    tenantId: string,
    sectionId: string,
    studentId: string,
    dateMinutes: Array<[string, number]>,
  ): Promise<void> {
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    const recordRepo = dataSource.getRepository(AttendanceRecord);
    for (const [date, minutesLate] of dateMinutes) {
      let session = await sessionRepo.findOne({
        where: { tenant_id: tenantId, section_id: sectionId, date, period_no: IsNull() },
      });
      if (!session) {
        session = await sessionRepo.save({
          tenant_id: tenantId,
          section_id: sectionId,
          date,
          period_no: null,
          state: AttendanceSessionState.FINALIZED,
        });
      }
      await recordRepo.save({
        tenant_id: tenantId,
        session_id: session.id,
        student_id: studentId,
        date,
        status: AttendanceStatus.LATE,
        minutes_late: minutesLate,
      });
    }
  }

  it('a class rule overrides the default for a student in that class', async () => {
    const { tenantId, yearId, classId, sectionId } = await setupTenant('2026-01-01', '2026-12-31');
    const otherSection = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'Other Section', class_id: classId, tenant_id: tenantId });
    const classB = await dataSource
      .getRepository(Class)
      .save({ name: 'Class B', academic_year_id: yearId, tenant_id: tenantId });
    const sectionB = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'Section B', class_id: classB.id, tenant_id: tenantId });

    const defaultStructureId = await makeStructure(tenantId, yearId, 20);
    const classStructureId = await makeStructure(tenantId, yearId, 50);
    await makeRule({ tenantId, yearId, structureId: defaultStructureId });
    await makeRule({ tenantId, yearId, classId: classB.id, structureId: classStructureId });

    const defaultStudent = await makeStudent(tenantId, sectionId, 'Default');
    const classStudent = await makeStudent(tenantId, sectionB.id, 'ClassB');
    await markAbsences(tenantId, sectionId, defaultStudent, ['2026-03-02', '2026-03-03', '2026-03-04']);
    await markAbsences(tenantId, sectionB.id, classStudent, ['2026-03-02', '2026-03-03']);
    void otherSection;

    const rows = await service.compute(tenantId, '2026-03', {});
    const defaultRow = rows.find((r) => r.student_id === defaultStudent);
    const classRow = rows.find((r) => r.student_id === classStudent);

    expect(defaultRow).toMatchObject({ count: 3, amount: 60, fee_structure_id: defaultStructureId });
    expect(classRow).toMatchObject({ count: 2, amount: 100, fee_structure_id: classStructureId });
  });

  it('applies free_per_period and cap_per_period', async () => {
    const { tenantId, yearId, sectionId } = await setupTenant('2026-01-01', '2026-12-31');
    const structureId = await makeStructure(tenantId, yearId, 20);
    await makeRule({ tenantId, yearId, structureId, freePerPeriod: 1, capPerPeriod: 200 });

    const student5 = await makeStudent(tenantId, sectionId, 'Five');
    const student15 = await makeStudent(tenantId, sectionId, 'Fifteen');
    const fiveDates = ['04-01', '04-02', '04-03', '04-04', '04-05'].map((d) => `2026-${d}`);
    const fifteenDates = Array.from({ length: 15 }, (_, i) => `2026-04-${String(i + 1).padStart(2, '0')}`);
    await markAbsences(tenantId, sectionId, student5, fiveDates);
    await markAbsences(tenantId, sectionId, student15, fifteenDates);

    const rows = await service.compute(tenantId, '2026-04', {});
    // 5 absences, 1 free -> 4 billable x ৳20 = ৳80.
    expect(rows.find((r) => r.student_id === student5)).toMatchObject({ count: 5, amount: 80 });
    // 15 absences, 1 free -> 14 billable x ৳20 = ৳280, capped to ৳200.
    expect(rows.find((r) => r.student_id === student15)).toMatchObject({ count: 15, amount: 200 });
  });

  it('produces no row for a student with zero fined occurrences', async () => {
    const { tenantId, yearId, sectionId } = await setupTenant('2026-01-01', '2026-12-31');
    const structureId = await makeStructure(tenantId, yearId, 20);
    await makeRule({ tenantId, yearId, structureId });
    await makeStudent(tenantId, sectionId, 'NeverAbsent');

    const rows = await service.compute(tenantId, '2026-05', {});
    expect(rows).toEqual([]);
  });

  it('generate is idempotent under SKIP — a second run creates nothing', async () => {
    const { tenantId, yearId, sectionId } = await setupTenant('2026-01-01', '2026-12-31');
    const structureId = await makeStructure(tenantId, yearId, 20);
    await makeRule({ tenantId, yearId, structureId });
    const studentId = await makeStudent(tenantId, sectionId, 'Idempotent');
    await markAbsences(tenantId, sectionId, studentId, ['2026-06-02', '2026-06-03']);

    const first = await service.generate(tenantId, null, '2026-06', {}, DuplicateStrategy.SKIP, false);
    expect(first.generated_count).toBe(1);

    const second = await service.generate(tenantId, null, '2026-06', {}, DuplicateStrategy.SKIP, false);
    expect(second.generated_count).toBe(0);
  });

  it('runDue does nothing before the correction window closes, bills the previous month after', async () => {
    const { tenantId, yearId, sectionId } = await setupTenant('2026-01-01', '2026-12-31');
    const structureId = await makeStructure(tenantId, yearId, 20);
    await makeRule({ tenantId, yearId, structureId });
    const studentId = await makeStudent(tenantId, sectionId, 'RunDue');
    await markAbsences(tenantId, sectionId, studentId, ['2026-08-05']);

    // Default correctionWindowDays is 2 -> day 2 of September is too early.
    await service.runDue(tenantId, '2026-09-02');
    const beforeWindow = await dataSource
      .getRepository(StudentFee)
      .find({ where: { student_id: studentId, fee_structure_id: structureId } });
    expect(beforeWindow).toHaveLength(0);

    // Day 3 (correctionWindowDays + 1) bills August.
    await service.runDue(tenantId, '2026-09-03');
    const afterWindow = await dataSource
      .getRepository(StudentFee)
      .find({ where: { student_id: studentId, fee_structure_id: structureId } });
    expect(afterWindow).toHaveLength(1);
  });

  it('bills carry fine_rule_id + note, and the FeeGeneration row has source FINE_RULE', async () => {
    const { tenantId, yearId, sectionId } = await setupTenant('2026-01-01', '2026-12-31');
    const structureId = await makeStructure(tenantId, yearId, 20);
    const ruleId = await makeRule({ tenantId, yearId, structureId });
    const studentId = await makeStudent(tenantId, sectionId, 'Traceable');
    await markAbsences(tenantId, sectionId, studentId, ['2026-07-01', '2026-07-02']);

    const result = await service.generate(tenantId, null, '2026-07', {}, DuplicateStrategy.SKIP, false);
    const bill = await dataSource
      .getRepository(StudentFee)
      .findOneOrFail({ where: { student_id: studentId, fee_structure_id: structureId } });
    expect(bill.fine_rule_id).toBe(ruleId);
    expect(bill.note).toBe('2 absent days');

    const feeGeneration = await dataSource
      .getRepository(FeeGeneration)
      .findOneOrFail({ where: { id: result.fee_generation_ids[0] } });
    expect(feeGeneration.source).toBe(FeeGenerationSource.FINE_RULE);
  });

  it('a 100% DiscountRule on FINE fully discounts the bill (D12)', async () => {
    const { tenantId, yearId, sectionId } = await setupTenant('2026-01-01', '2026-12-31');
    const structureId = await makeStructure(tenantId, yearId, 20);
    await makeRule({ tenantId, yearId, structureId });
    const studentId = await makeStudent(tenantId, sectionId, 'Discounted');
    await markAbsences(tenantId, sectionId, studentId, ['2026-09-15']);

    await dataSource.getRepository(DiscountRule).save({
      tenant_id: tenantId,
      student_id: studentId,
      kind: DiscountKind.PERCENT,
      value: 100,
      fee_types: null,
      reason: 'Test full discount',
      created_by_user_id: SEED_ADMIN_USER_ID,
      approved_by_user_id: SEED_ADMIN_USER_ID,
      is_active: true,
    });

    await service.generate(tenantId, null, '2026-09', {}, DuplicateStrategy.SKIP, false);
    const bill = await dataSource
      .getRepository(StudentFee)
      .findOneOrFail({ where: { student_id: studentId, fee_structure_id: structureId } });
    expect(Number(bill.discount_amount)).toBe(Number(bill.total_amount));
  });

  it('a student who moves class mid-month is billed once, under the rule matching their CURRENT class', async () => {
    // D21/D22 regression: class-rule resolution must key off each
    // student's actual latest class, not off which rule's SQL happened to
    // return them — otherwise a moved student gets split/double-counted or
    // billed under a rule that no longer applies to them.
    const { tenantId, yearId, classId, sectionId } = await setupTenant('2026-01-01', '2026-12-31');
    const classB = await dataSource
      .getRepository(Class)
      .save({ name: 'Class B', academic_year_id: yearId, tenant_id: tenantId });
    const sectionB = await dataSource
      .getRepository(ClassSection)
      .save({ section_name: 'Section B', class_id: classB.id, tenant_id: tenantId });
    void classId;

    const defaultStructureId = await makeStructure(tenantId, yearId, 10);
    const classBStructureId = await makeStructure(tenantId, yearId, 50);
    // Default: no threshold, every LATE counts. Class B: only >=10 minutes.
    await makeRule({
      tenantId,
      yearId,
      structureId: defaultStructureId,
      trigger: FineTrigger.ATTENDANCE_LATE,
      conditions: {},
    });
    await makeRule({
      tenantId,
      yearId,
      classId: classB.id,
      structureId: classBStructureId,
      trigger: FineTrigger.ATTENDANCE_LATE,
      conditions: { min_minutes_late: 10 },
    });

    const studentId = await makeStudent(tenantId, sectionB.id, 'Mover');
    // Started the month in Class B (2 lates >=10min, would match Class B's
    // rule), then moved to the default class before month-end (1 more late
    // <10min, which only the default rule's looser threshold counts).
    await markLate(tenantId, sectionB.id, studentId, [
      ['2026-10-02', 15],
      ['2026-10-05', 12],
    ]);
    await dataSource
      .getRepository(Student)
      .update({ id: studentId }, { class_section_id: sectionId });
    await markLate(tenantId, sectionId, studentId, [['2026-10-20', 5]]);

    const rows = await service.compute(tenantId, '2026-10', {});
    const studentRows = rows.filter((r) => r.student_id === studentId);

    // Exactly one row: the student's LATEST class (the default one) wins
    // outright, counting ALL 3 late days under the default's own looser
    // conditions — not split across both rules, not billed under Class B's
    // now-stale rule.
    expect(studentRows).toHaveLength(1);
    expect(studentRows[0]).toMatchObject({
      count: 3,
      amount: 30,
      fee_structure_id: defaultStructureId,
    });
  });
});
