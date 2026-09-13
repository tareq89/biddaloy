import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { FeeStructure } from '../fees/entities/fee-structure.entity';
import { FeeGeneration } from '../fees/entities/fee-generation.entity';
import { StudentFee } from '../fees/entities/student-fee.entity';
import { Student } from '../students/entities/student.entity';
import { Guardian } from '../students/entities/guardian.entity';
import { CommunicationLog } from './entities/communication-log.entity';
import { FeeGenerationsService } from '../fees/fee-generations.service';
import { AuditService } from '../audit/audit.service';
import { SmsCreditService } from './credits/sms-credit.service';
import { SmsCreditBalance } from './credits/entities/sms-credit-balance.entity';
import { SmsCreditLedger } from './credits/entities/sms-credit-ledger.entity';
import { FeeNotificationsListener } from './fee-notifications.listener';
import {
  CommunicationMedium,
  CommunicationStatus,
  DuplicateStrategy,
  FeeGenerationSource,
  FeeType,
  PeriodType,
} from '@biddaloy/shared';

/**
 * Integration coverage for [16.3.4]'s listener business logic, against the
 * real, migrated `communication_logs`/`student_fees`/`fee_generations`
 * schema.
 *
 * Built directly (`new FeeNotificationsListener(...)`) with a fake queue
 * and a stub `SchoolsService`/`AuditService`, the same scoped-setup
 * pattern `sms-credit.service.integration.spec.ts` uses, rather than
 * wiring the whole `CommunicationsModule` — that module sits behind
 * `SchoolsModule <-> AccountAccessModule`'s `forwardRef` cycle, which only
 * resolves inside the full `AppModule` graph, not a partial test module.
 * `@OnEvent('fees.generated')`'s registration itself is covered by reading
 * `communications.module.ts` (the listener is a `providers` entry, decorated
 * with `@OnEvent`) rather than re-proving Nest's event-emitter wiring here.
 */
describe('FeeNotificationsListener (integration)', () => {
  let dataSource: DataSource;
  let logRepo: Repository<CommunicationLog>;
  let feeGenerationsService: FeeGenerationsService;
  let smsCreditService: SmsCreditService;
  let listener: FeeNotificationsListener;
  let queuedJobs: Array<{ name: string; data: any }>;

  const TENANT_ID = '00000000-0000-4000-8000-000000000f01';
  const OTHER_TENANT_ID = '00000000-0000-4000-8000-000000000f02';

  let academicYearId: string;
  let classSectionId: string;
  let otherTenantClassSectionId: string;
  let feeStructureMonthlyId: string;
  let feeStructureExamId: string;

  async function createClassSection(tenantId: string, yearId: string): Promise<string> {
    const klass = await dataSource.getRepository(Class).save({
      name: 'Fee Notify Class ' + Math.random(),
      academic_year_id: yearId,
      tenant_id: tenantId,
    });
    const section = await dataSource.getRepository(ClassSection).save({
      section_name: 'FN',
      class_id: klass.id,
      tenant_id: tenantId,
    });
    return section.id;
  }

  async function seedTenant(tenantId: string, name: string): Promise<void> {
    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: tenantId } }))) {
      await schoolRepo.save({
        id: tenantId,
        name,
        slug: `fee-notify-${tenantId.slice(-4)}`,
      });
    }
  }

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [FeeGenerationsService, AuditService], []);
    dataSource = module.get<DataSource>(getDataSourceToken());
    logRepo = module.get(getRepositoryToken(CommunicationLog));
    feeGenerationsService = module.get(FeeGenerationsService);

    const balanceRepo = module.get<Repository<SmsCreditBalance>>(getRepositoryToken(SmsCreditBalance));
    const ledgerRepo = module.get<Repository<SmsCreditLedger>>(getRepositoryToken(SmsCreditLedger));
    // No `communications.sms` block on the seeded tenants below, so
    // `isMetered` never actually needs a real answer here.
    smsCreditService = new SmsCreditService(balanceRepo, ledgerRepo, dataSource, {
      getResolvedSettings: async () => ({ communications: {}, region: { locale: 'en-US' } }) as any,
    } as any);

    listener = new FeeNotificationsListener(
      logRepo,
      dataSource,
      { add: async (name: string, data: any) => queuedJobs.push({ name, data }) } as any,
      feeGenerationsService,
      { getResolvedSettings: async () => ({ communications: {}, region: { locale: 'en-US' } }) } as any,
      smsCreditService,
    );

    await seedTenant(TENANT_ID, 'Fee Notify School');
    await seedTenant(OTHER_TENANT_ID, 'Fee Notify Other School');
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  // The global `beforeEach` (`test/setup.ts`) truncates every transactional
  // table — `fee_structures`/`academic_years`/`class_sections`/`students`/
  // `guardians`/`student_fees`/`fee_generations`/`communication_logs`
  // included — before each `it()` runs. Fixtures that rows in THIS test
  // depend on must therefore be (re)created here, not in `beforeAll`: a
  // `beforeAll`-created row would already be gone by the time the first
  // test's assertions run, and every FK insert after it would 23503.
  beforeEach(async () => {
    queuedJobs = [];

    const year = await dataSource.getRepository(AcademicYear).save({
      name: `Fee Notify Year ${Date.now()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    academicYearId = year.id;
    classSectionId = await createClassSection(TENANT_ID, academicYearId);

    const otherYear = await dataSource.getRepository(AcademicYear).save({
      name: `Fee Notify Other Year ${Date.now()}`,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: OTHER_TENANT_ID,
    });
    otherTenantClassSectionId = await createClassSection(OTHER_TENANT_ID, otherYear.id);

    const structureRepo = dataSource.getRepository(FeeStructure);
    const monthly = await structureRepo.save({
      name: 'Monthly Fee',
      fee_type: FeeType.MONTHLY_TUITION,
      amount: 4200,
      academic_year_id: academicYearId,
      tenant_id: TENANT_ID,
    });
    const exam = await structureRepo.save({
      name: 'Exam Fee',
      fee_type: FeeType.EXAM_FEE,
      amount: 800,
      academic_year_id: academicYearId,
      tenant_id: TENANT_ID,
    });
    feeStructureMonthlyId = monthly.id;
    feeStructureExamId = exam.id;
  }, 30000);

  async function createBatch(overrides: Partial<FeeGeneration> = {}): Promise<FeeGeneration> {
    return dataSource.getRepository(FeeGeneration).save({
      tenant_id: TENANT_ID,
      academic_year_id: academicYearId,
      period_start: '2026-09-01',
      period_type: PeriodType.MONTH,
      due_date: '2026-09-10',
      source: FeeGenerationSource.MANUAL,
      duplicate_strategy: DuplicateStrategy.SKIP,
      notify_families: true,
      structures: [
        { id: feeStructureMonthlyId, name: 'Monthly Fee', fee_type: 'MONTHLY_TUITION', amount: 4200 },
      ],
      student_count: 1,
      generated_count: 1,
      skipped_count: 0,
      removed_count: 0,
      ...overrides,
    });
  }

  async function createStudentWithGuardian(params: {
    tenantId: string;
    guardianPhone?: string | null;
    guardianEmail?: string | null;
  }): Promise<{ studentId: string; guardianId: string }> {
    const guardian = await dataSource.getRepository(Guardian).save({
      full_name: 'Guardian ' + Date.now() + Math.random(),
      relationship: 'Father',
      phone: params.guardianPhone === undefined ? '01711111111' : params.guardianPhone,
      email: params.guardianEmail ?? null,
      is_primary_contact: true,
      notifications_enabled: true,
      preferred_communication: CommunicationMedium.SMS,
      tenant_id: params.tenantId,
    });
    const student = await dataSource.getRepository(Student).save({
      full_name: 'Student ' + Date.now() + Math.random(),
      registration_number: `FN-REG-${Date.now()}-${Math.random()}`,
      roll_number: Math.floor(Math.random() * 100000),
      class_section_id: params.tenantId === TENANT_ID ? classSectionId : otherTenantClassSectionId,
      tenant_id: params.tenantId,
      guardians: [guardian],
    });
    return { studentId: student.id, guardianId: guardian.id };
  }

  async function createBill(params: {
    studentId: string;
    feeGenerationId: string;
    feeStructureId: string;
    amount: number;
  }): Promise<void> {
    await dataSource.getRepository(StudentFee).save({
      student_id: params.studentId,
      academic_year_id: academicYearId,
      fee_structure_id: params.feeStructureId,
      fee_generation_id: params.feeGenerationId,
      period_start: '2026-09-01',
      total_amount: params.amount,
      due_date: '2026-09-10',
    });
  }

  it('queues one job (one QUEUED log) per guardian, covering every bill for their student', async () => {
    const batch = await createBatch();
    const { studentId, guardianId } = await createStudentWithGuardian({ tenantId: TENANT_ID });
    await createBill({
      studentId,
      feeGenerationId: batch.id,
      feeStructureId: feeStructureMonthlyId,
      amount: 4200,
    });
    await createBill({
      studentId,
      feeGenerationId: batch.id,
      feeStructureId: feeStructureExamId,
      amount: 800,
    });

    await listener.handleFeesGenerated({ tenantId: TENANT_ID, feeGenerationId: batch.id });

    const logs = await logRepo.find({ where: { guardian_id: guardianId } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe(CommunicationStatus.QUEUED);
    expect(logs[0].medium).toBe(CommunicationMedium.WHATSAPP);
    expect(logs[0].message_body).toContain('Monthly Fee 4,200');
    expect(logs[0].message_body).toContain('Exam Fee 800');
    expect(logs[0].reference_key).toBe(`fee-notify:${batch.id}:${guardianId}`);

    const jobsForThisLog = queuedJobs.filter((j) => j.data.logId === logs[0].id);
    expect(jobsForThisLog).toHaveLength(1);
  });

  it('re-emitting the same event creates zero new logs and zero new jobs (idempotent per feeGenerationId+guardianId)', async () => {
    const batch = await createBatch();
    const { studentId, guardianId } = await createStudentWithGuardian({ tenantId: TENANT_ID });
    await createBill({
      studentId,
      feeGenerationId: batch.id,
      feeStructureId: feeStructureMonthlyId,
      amount: 4200,
    });

    await listener.handleFeesGenerated({ tenantId: TENANT_ID, feeGenerationId: batch.id });
    const countAfterFirst = await logRepo.count({ where: { guardian_id: guardianId } });
    const jobsAfterFirst = queuedJobs.length;
    expect(countAfterFirst).toBe(1);

    await listener.handleFeesGenerated({ tenantId: TENANT_ID, feeGenerationId: batch.id });
    const countAfterReplay = await logRepo.count({ where: { guardian_id: guardianId } });
    expect(countAfterReplay).toBe(1);
    expect(queuedJobs.length).toBe(jobsAfterFirst);
  });

  it('never resolves a guardian belonging to another tenant', async () => {
    const batch = await createBatch();
    const { studentId } = await createStudentWithGuardian({ tenantId: TENANT_ID });
    await createBill({
      studentId,
      feeGenerationId: batch.id,
      feeStructureId: feeStructureMonthlyId,
      amount: 4200,
    });

    // A guardian/student pair on a different tenant, unrelated to this
    // batch — proves the student lookup is tenant-scoped, not just
    // id-scoped.
    const other = await createStudentWithGuardian({ tenantId: OTHER_TENANT_ID });

    await listener.handleFeesGenerated({ tenantId: TENANT_ID, feeGenerationId: batch.id });

    const otherTenantLogs = await logRepo.find({ where: { guardian_id: other.guardianId } });
    expect(otherTenantLogs).toHaveLength(0);
  });

  it('does nothing when the batch has notify_families = false', async () => {
    const batch = await createBatch({ notify_families: false });
    const { studentId, guardianId } = await createStudentWithGuardian({ tenantId: TENANT_ID });
    await createBill({
      studentId,
      feeGenerationId: batch.id,
      feeStructureId: feeStructureMonthlyId,
      amount: 4200,
    });

    await listener.handleFeesGenerated({ tenantId: TENANT_ID, feeGenerationId: batch.id });

    const logs = await logRepo.find({ where: { guardian_id: guardianId } });
    expect(logs).toHaveLength(0);
  });

  it('records SKIPPED_NO_SMS (never queues) for a guardian with no phone and SMS disabled', async () => {
    const batch = await createBatch();
    const { studentId, guardianId } = await createStudentWithGuardian({
      tenantId: TENANT_ID,
      guardianPhone: null,
      guardianEmail: 'nophone@example.com',
    });
    await createBill({
      studentId,
      feeGenerationId: batch.id,
      feeStructureId: feeStructureMonthlyId,
      amount: 4200,
    });

    await listener.handleFeesGenerated({ tenantId: TENANT_ID, feeGenerationId: batch.id });

    const logs = await logRepo.find({ where: { guardian_id: guardianId } });
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe(CommunicationStatus.FAILED);
    expect((logs[0].metadata as any)?.reason).toBe('SKIPPED_NO_SMS');
    expect(queuedJobs.some((j) => j.data.logId === logs[0].id)).toBe(false);
  });
});
