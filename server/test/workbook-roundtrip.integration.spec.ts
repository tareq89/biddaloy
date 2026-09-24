import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { DataSource } from 'typeorm';
import JSZip from 'jszip';
import {
  FeeType,
  FeeStatus,
  InvoiceKind,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  PaymentAllocationType,
  EnrollmentStatus,
  UserRole,
  ExamKind,
  ExamStatus,
  ExamComponentKind,
  ExamComponentSource,
  MarkStatus,
  MarkGridState,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { buildResetSql } from '@test/reset-order';
import { normalizeWorkbook, diffNormalized } from './workbook-normalize';
import { AuditService } from '../src/modules/audit/audit.service';
import { AuditLog } from '../src/modules/audit/entities/audit-log.entity';
import { School } from '../src/modules/schools/entities/school.entity';
import { AcademicYear } from '../src/modules/academics/entities/academic-year.entity';
import { Class } from '../src/modules/academics/entities/class.entity';
import { ClassSection } from '../src/modules/academics/entities/class-section.entity';
import { Student } from '../src/modules/students/entities/student.entity';
import { Guardian } from '../src/modules/students/entities/guardian.entity';
import { Enrollment } from '../src/modules/students/entities/enrollment.entity';
import { User } from '../src/modules/users/entities/user.entity';
import { UserTenant } from '../src/modules/auth/entities/user-tenant.entity';
import { FeeStructure } from '../src/modules/fees/entities/fee-structure.entity';
import { StudentFee } from '../src/modules/fees/entities/student-fee.entity';
import { Invoice } from '../src/modules/invoices/entities/invoice.entity';
import { Payment } from '../src/modules/fees/entities/payment.entity';
import { PaymentAllocation } from '../src/modules/fees/entities/payment-allocation.entity';
import { GradingScale } from '../src/modules/grading/entities/grading-scale.entity';
import { GradingBand } from '../src/modules/grading/entities/grading-band.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { ClassSubject } from '../src/modules/academics/entities/class-subject.entity';
import { Exam } from '../src/modules/exams/entities/exam.entity';
import { ExamComponent } from '../src/modules/exams/entities/exam-component.entity';
import { ExamSchedule } from '../src/modules/exams/entities/exam-schedule.entity';
import { Mark } from '../src/modules/exams/entities/mark.entity';
import { MarkGrid } from '../src/modules/exams/entities/mark-grid.entity';
import { Result } from '../src/modules/exams/entities/result.entity';
import { ResultSubject } from '../src/modules/exams/entities/result-subject.entity';
import { StudentSubjectChoice } from '../src/modules/students/entities/student-subject-choice.entity';
import { DEMO_ORGANISATION, ensureDemoStudents, SEED_DEVICE_KEY } from '../src/scripts/seed.util';
import { ImportStagingService } from '../src/modules/bulk-import/import-staging.service';
import { ValidationService } from '../src/modules/workbook/import/validation.service';
import { DiffService } from '../src/modules/workbook/import/diff.service';
import { ExportProcessor } from '../src/modules/workbook/export/export.processor';
import { RestoreProcessor } from '../src/modules/workbook/restore/restore.processor';
import {
  readWorkbook,
  type ReadWorkbookResult,
  type SheetData,
} from '../src/modules/workbook/codec/workbook-codec';
import { ALL_TABS } from '../src/modules/workbook/codec/registry';
import { SCHEMA_VERSION } from '../src/modules/workbook/codec/meta';
import type { TabSpec } from '../src/modules/workbook/codec/tab-spec';
import {
  WorkbookJob,
  WorkbookJobKind,
  WorkbookJobSource,
  WorkbookJobStatus,
} from '../src/modules/workbook/jobs/workbook-job.entity';
import { Subject } from '../src/modules/academics/entities/subject.entity';
import { Teacher } from '../src/modules/academics/entities/teacher.entity';
import { Shift } from '../src/modules/routines/entities/shift.entity';
import { PeriodSlot } from '../src/modules/routines/entities/period-slot.entity';
import { Room } from '../src/modules/routines/entities/room.entity';
import { Routine } from '../src/modules/routines/entities/routine.entity';
import { RoutineSlot } from '../src/modules/routines/entities/routine-slot.entity';
import { RoutineSlotTeacher } from '../src/modules/routines/entities/routine-slot-teacher.entity';
import { RoutineSubstitution } from '../src/modules/routines/entities/routine-substitution.entity';
import { RoutineChangeRequest } from '../src/modules/routines/entities/routine-change-request.entity';
import {
  PeriodSlotKind,
  SlotRecurrence,
  RoutineState,
  ChangeRequestState,
  TeacherDesignation,
} from '@biddaloy/shared';

/**
 * The spine test (14.10.4): export a seeded tenant A, tear A's data down,
 * validate/diff that workbook against empty tenant B, restore it in,
 * re-export B, and assert the two exports are the same data once identity
 * noise is normalized away (`workbook-normalize.ts`).
 *
 * ```
 *   seed A ──▶ export A ──▶ bufferA ────────────────────────────┐
 *                              │                                │
 *                         wipe A's data                         │
 *                              │                                ▼
 *                              ▼                    normalize + compare
 *              validate/diff bufferA vs empty B                 ▲
 *                              │                                │
 *                              ▼                                │
 *                   restore into B ──▶ export B ──▶ bufferB ────┘
 * ```
 *
 * **Why A is torn down first:** several workbook natural keys carry *global*
 * unique constraints rather than tenant-scoped ones
 * (`students.registration_number`, `teachers.employee_id`, `users.email`),
 * and the restore tabs deliberately refuse to move such a row between
 * tenants. Restoring A's workbook into a second *live* tenant is therefore
 * not a supported scenario and must not be asserted; what restore does
 * support — and what this models — is disaster recovery, where the source
 * data is gone and the workbook puts it back. See step 1b in the test body.
 *
 * **If you add a new workbook tab and this spec goes red, that is the
 * signal to look at first** — it means the new tab's export/import/diff
 * round trip does not agree with itself, which every other spec in this
 * codebase is too narrow to catch (they each exercise one tab or one
 * processor in isolation). This file intentionally has no per-tab
 * assertions of its own; `normalizeWorkbook`'s uuid-column derivation from
 * `ALL_TABS` means a new tab is covered automatically.
 *
 * Clones the harness from `export/export.integration.spec.ts` (fake
 * storage, fake job) and `restore/restore.integration.spec.ts` (fake
 * Redis staging, direct `RestoreProcessor` construction) rather than
 * inventing a new one — see plan comment on issue #610.
 */

vi.mock('@sentry/node', () => ({
  withScope: (fn: (scope: any) => void) => fn({ setTags: vi.fn() }),
  captureException: vi.fn(),
}));

/** In-memory stand-in for `StorageService` — mirrors both
 * `export.integration.spec.ts` and `restore.integration.spec.ts`. */
class FakeStorageService {
  readonly objects = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<void> {
    this.objects.set(key, body);
  }

  async get(key: string): Promise<{ body: AsyncIterable<Buffer> }> {
    const body = this.objects.get(key);
    if (!body) throw new Error(`FakeStorageService: no object at "${key}"`);
    return {
      body: (async function* () {
        yield body;
      })(),
    };
  }
}

/** Minimal in-memory Redis stand-in for `ImportStagingService` — the same
 * three commands `restore.integration.spec.ts` fakes. */
class FakeRedis {
  private readonly store = new Map<string, string>();

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async getdel(key: string): Promise<string | null> {
    const value = this.store.get(key) ?? null;
    this.store.delete(key);
    return value;
  }
}

function fakeExportJob(jobId: string, tenantId: string) {
  return { data: { jobId, tenantId }, opts: { attempts: 2 }, attemptsMade: 0 } as any;
}

function fakeRestoreJob(jobId: string) {
  return { data: { jobId, inviteUsers: false } } as any;
}

/** Builds a hand-crafted `ReadWorkbookResult` for the pure unit tests below
 * — no real .xlsx needed since `normalizeWorkbook` only reads `sheets`. */
function makeResult(sheets: Record<string, SheetData>): ReadWorkbookResult {
  return {
    meta: {
      schema_version: SCHEMA_VERSION,
      kind: 'BACKUP',
      exported_at: '2026-01-01T00:00:00.000Z',
      app_version: 'test',
      source_school_name: 'Unit Test School',
      source_school_slug: 'unit-test-school',
    },
    sheets: new Map(Object.entries(sheets)),
    warnings: [],
  };
}

/** A minimal fake tab, typed loosely — only the fields `normalizeWorkbook`
 * actually reads (`name`, `columns`, `naturalKey`) are meaningful. */
function fakeTab(
  name: string,
  columns: Array<{ key: string; type: string }>,
  naturalKey: string[],
): TabSpec<unknown, unknown> {
  return { name, columns, naturalKey } as unknown as TabSpec<unknown, unknown>;
}

describe('workbook-normalize (unit)', () => {
  const studentsTab = fakeTab(
    'students',
    [
      { key: 'id', type: 'uuid' },
      { key: 'registration_id', type: 'string' },
      { key: 'name', type: 'string' },
    ],
    ['registration_id'],
  );
  const teachersTab = fakeTab(
    'teachers',
    [
      { key: 'id', type: 'uuid' },
      { key: 'employee_id', type: 'string' },
    ],
    ['employee_id'],
  );

  it('drops uuid-typed columns but keeps registration_id/employee_id (C1 regression)', () => {
    const result = makeResult({
      students: {
        header: ['id', 'registration_id', 'name'],
        rows: [{ rowNo: 2, cells: { id: 'uuid-1', registration_id: 'REG-1', name: 'Karim' } }],
      },
      teachers: {
        header: ['id', 'employee_id'],
        rows: [{ rowNo: 2, cells: { id: 'uuid-2', employee_id: 'EMP-1' } }],
      },
    });

    const normalized = normalizeWorkbook(result, [studentsTab, teachersTab]);
    expect(normalized.students).toEqual([{ registration_id: 'REG-1', name: 'Karim' }]);
    expect(normalized.teachers).toEqual([{ employee_id: 'EMP-1' }]);
  });

  it('row order does not affect equality', () => {
    const a = makeResult({
      students: {
        header: ['id', 'registration_id', 'name'],
        rows: [
          { rowNo: 2, cells: { id: 'u1', registration_id: 'REG-1', name: 'A' } },
          { rowNo: 3, cells: { id: 'u2', registration_id: 'REG-2', name: 'B' } },
        ],
      },
    });
    const b = makeResult({
      students: {
        header: ['id', 'registration_id', 'name'],
        rows: [
          { rowNo: 2, cells: { id: 'u9', registration_id: 'REG-2', name: 'B' } },
          { rowNo: 3, cells: { id: 'u8', registration_id: 'REG-1', name: 'A' } },
        ],
      },
    });

    expect(normalizeWorkbook(a, [studentsTab])).toEqual(normalizeWorkbook(b, [studentsTab]));
  });

  it('duplicate natural keys still compare deterministically', () => {
    const build = () =>
      makeResult({
        students: {
          header: ['id', 'registration_id', 'name'],
          rows: [
            { rowNo: 2, cells: { id: 'u1', registration_id: 'DUP', name: 'X' } },
            { rowNo: 3, cells: { id: 'u2', registration_id: 'DUP', name: 'Y' } },
          ],
        },
      });

    const first = normalizeWorkbook(build(), [studentsTab]);
    const second = normalizeWorkbook(build(), [studentsTab]);
    expect(first).toEqual(second);
  });

  it('a missing sheet is not silently equal to an empty sheet', () => {
    const missing = normalizeWorkbook(makeResult({}), [studentsTab]);
    const empty = normalizeWorkbook(
      makeResult({ students: { header: ['id', 'registration_id', 'name'], rows: [] } }),
      [studentsTab],
    );
    expect(missing.students).toBeUndefined();
    expect(empty.students).toEqual([]);
    expect(diffNormalized(missing, empty)).not.toEqual([]);
  });

  it('diffNormalized names the tab and column on a single-cell difference', () => {
    const a = normalizeWorkbook(
      makeResult({
        students: {
          header: ['id', 'registration_id', 'name'],
          rows: [{ rowNo: 2, cells: { id: 'u1', registration_id: 'REG-1', name: 'Karim' } }],
        },
      }),
      [studentsTab],
    );
    const b = normalizeWorkbook(
      makeResult({
        students: {
          header: ['id', 'registration_id', 'name'],
          rows: [{ rowNo: 2, cells: { id: 'u1', registration_id: 'REG-1', name: 'Rahim' } }],
        },
      }),
      [studentsTab],
    );

    const diff = diffNormalized(a, b);
    expect(diff).toHaveLength(1);
    expect(diff[0]).toContain('students');
    expect(diff[0]).toContain('name');
  });
});

describe('workbook round trip (integration)', () => {
  let dataSource: DataSource;
  let auditService: AuditService;
  let storage: FakeStorageService;
  let exportProcessor: ExportProcessor;
  let restoreProcessor: RestoreProcessor;
  let validationService: ValidationService;
  let diffService: DiffService;
  let staging: ImportStagingService;

  const TENANT_A = randomUUID();
  const TENANT_B = randomUUID();
  const USER_ID = randomUUID();
  /**
   * Whoever clicks "restore" — deliberately a *different* user from
   * `USER_ID`, and deliberately with no `user_tenants` membership.
   *
   * `workbook_jobs.requested_by_user_id` is a FK onto `users`, and tenant A's
   * member (`USER_ID`) is deleted by the teardown in step 1b, so the restore
   * job cannot be attributed to them. Giving the operator no membership also
   * keeps them out of the `users` tab (which loads tenant members, see
   * `users.tab.ts`), so they cannot perturb the round-trip comparison.
   */
  const OPERATOR_ID = randomUUID();
  const PROVIDER_SECRET = `provider-secret-${randomUUID()}`;
  const SEEDED_PASSWORD_HASH = `seeded-password-hash-${randomUUID()}`;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    auditService = new AuditService(dataSource.getRepository(AuditLog));
    storage = new FakeStorageService();
    staging = new ImportStagingService(new FakeRedis() as any);
    validationService = new ValidationService();
    diffService = new DiffService();

    exportProcessor = new ExportProcessor(
      dataSource.getRepository(WorkbookJob),
      dataSource,
      storage as any,
      auditService,
      { emitFinished: vi.fn() } as any,
      { enforce: vi.fn().mockResolvedValue(undefined) } as any,
    );

    const restoreServiceStub = { release: vi.fn().mockResolvedValue(undefined) };
    const invitationsStub = { issueAndSend: vi.fn().mockResolvedValue({ status: 'SENT' }) };
    restoreProcessor = new RestoreProcessor(
      dataSource.getRepository(WorkbookJob),
      dataSource,
      storage as any,
      staging,
      validationService,
      invitationsStub as any,
      auditService,
      { emitFinished: vi.fn() } as any,
      restoreServiceStub as any,
    );
  }, 60_000);

  /**
   * Builds the whole fixture.
   *
   * **This must run inside the test body, not in `beforeAll`.** `test/setup.ts`
   * registers a global `beforeEach` that runs `buildResetSql()` — a DELETE
   * sweep over all ~26 *transactional* tables (`students`, `guardians`,
   * `enrollments`, the whole `fee_structures` → `payment_allocations` chain,
   * `workbook_jobs`, ...). Global hooks are registered before this file's, so
   * the order is: setup.ts `beforeAll` → this file's `beforeAll` → setup.ts
   * `beforeEach` → the test. Anything transactional seeded in a `beforeAll`
   * is therefore deleted again before the first `it` ever runs, leaving only
   * the *reference* tables (`schools`, `users`, `user_tenants`,
   * `academic_years`, `classes`, `class_sections`, which are reset per file,
   * not per test) standing.
   *
   * That is not a theoretical hazard: it is exactly what this spec did before
   * — 15 of 18 tabs exported zero rows and the round-trip assertion compared
   * four near-empty sheets while appearing to pass. `assertFixtureIsMeaty`
   * below is the guard that makes a silent regression of that shape fail.
   */
  async function seedFixture(): Promise<void> {
    await dataSource.getRepository(School).save([
      dataSource.getRepository(School).create({
        id: TENANT_A,
        name: 'Roundtrip Test School A',
        slug: `roundtrip-a-${TENANT_A.slice(0, 8)}`,
        // Same leak-check pattern as export.integration.spec.ts: the
        // `school` tab redacts known secret paths before export.
        // [33.5.1] `organisation` is a plain (non-secret) settings key —
        // `ensureDemoStudents` below needs it present before it seeds
        // `DEMO_CLASSES`' shift/version/group values (see seed.util.ts).
        settings: {
          communications: { sms: { mimsms: { apiKey: PROVIDER_SECRET } } },
          organisation: DEMO_ORGANISATION,
        } as any,
      }),
      dataSource.getRepository(School).create({
        id: TENANT_B,
        name: 'Roundtrip Test School B (empty)',
        slug: `roundtrip-b-${TENANT_B.slice(0, 8)}`,
      }),
    ]);

    // A user whose password hash must never appear in workbook bytes —
    // referenced from the fee chain below (issued_by / received_by) so it
    // is exercised by a real tab, not planted in isolation.
    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: USER_ID,
        email: `roundtrip-610-${USER_ID.slice(0, 8)}@test.com`,
        full_name: 'Roundtrip Test Admin',
        password_hash: SEEDED_PASSWORD_HASH,
      }),
    );

    await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        id: OPERATOR_ID,
        email: `roundtrip-610-op-${OPERATOR_ID.slice(0, 8)}@test.com`,
        full_name: 'Roundtrip Restore Operator',
        password_hash: 'not-the-asserted-hash',
      }),
    );

    // The `users` tab loads tenant members via `user_tenants` (see
    // `users.tab.ts`'s `load`), so without this membership the user exports
    // as zero rows and the password-hash leak assertion below proves
    // nothing — the hash would be absent simply because the user was.
    await dataSource.getRepository(UserTenant).save(
      dataSource.getRepository(UserTenant).create({
        user_id: USER_ID,
        tenant_id: TENANT_A,
        role: UserRole.ADMIN,
      }),
    );

    // Small, deterministic student roster (C2: ensureDemoStudents seeds
    // people/academics tabs only — no fee/payment helper exists to reuse).
    await ensureDemoStudents(
      {
        academicYearRepository: dataSource.getRepository(AcademicYear),
        classRepository: dataSource.getRepository(Class),
        classSectionRepository: dataSource.getRepository(ClassSection),
        studentRepository: dataSource.getRepository(Student),
        guardianRepository: dataSource.getRepository(Guardian),
      },
      TENANT_A,
      // Matches the `organisation: DEMO_ORGANISATION` set on TENANT_A's
      // `School.settings` above (:381).
      DEMO_ORGANISATION,
    );

    const year = await dataSource
      .getRepository(AcademicYear)
      .findOneOrFail({ where: { tenant_id: TENANT_A } });
    const klass = await dataSource
      .getRepository(Class)
      .findOneOrFail({ where: { tenant_id: TENANT_A } });
    const section = await dataSource
      .getRepository(ClassSection)
      .findOneOrFail({ where: { tenant_id: TENANT_A, class_id: klass.id } });
    const student = await dataSource
      .getRepository(Student)
      .findOneOrFail({ where: { tenant_id: TENANT_A } });

    // One enrollment, so the `enrollments` tab (which resolves student,
    // class, section and academic year purely by natural key) is exercised
    // rather than exported empty.
    await dataSource.getRepository(Enrollment).save(
      dataSource.getRepository(Enrollment).create({
        student_id: student.id,
        class_id: klass.id,
        section_id: section.id,
        academic_year_id: year.id,
        enrollment_status: EnrollmentStatus.ACTIVE,
        tenant_id: TENANT_A,
      }),
    );

    // Minimal fee chain (C2): one FeeStructure -> one StudentFee -> one
    // Invoice -> one Payment -> one PaymentAllocation, enough to make
    // `fees/*` tabs non-empty (and their `dependsOn` order meaningful)
    // without taxing the 90s CI budget.
    const feeStructure = await dataSource.getRepository(FeeStructure).save(
      dataSource.getRepository(FeeStructure).create({
        fee_type: FeeType.MONTHLY_TUITION,
        name: 'Tuition - January',
        amount: 1500,
        class_id: klass.id,
        academic_year_id: year.id,
        section_id: null,
        tenant_id: TENANT_A,
      }),
    );

    const studentFee = await dataSource.getRepository(StudentFee).save(
      dataSource.getRepository(StudentFee).create({
        student_id: student.id,
        academic_year_id: year.id,
        fee_structure_id: feeStructure.id,
        // 16.1.3: `month`/`year` are generated from `period_start`.
        period_start: new Date(Date.UTC(2026, 0, 1)),
        total_amount: 1500,
        paid_amount: 1500,
        discount_amount: 0,
        status: FeeStatus.PAID,
        due_date: '2026-01-10',
      }),
    );

    // [16.5.1] Payment created before the invoice it backs: `Invoice`
    // now carries `payment_id`, and once an invoice's status leaves DRAFT
    // the D21 trigger blocks any later UPDATE to that column, so it must
    // be set at INSERT time.
    const payment = await dataSource.getRepository(Payment).save(
      dataSource.getRepository(Payment).create({
        student_id: student.id,
        total_amount: 1500,
        payment_method: PaymentMethod.CASH,
        payment_status: PaymentStatus.SUCCESS,
        transaction_reference: null,
        remarks: null,
        received_by_user_id: USER_ID,
        invoice_id: null,
        payment_date: new Date('2026-01-05T00:00:00.000Z'),
        tenant_id: TENANT_A,
      }),
    );

    // [16.5.1] `Invoice.snapshot` replaces `line_items`.
    const invoice = await dataSource.getRepository(Invoice).save(
      dataSource.getRepository(Invoice).create({
        invoice_number: `INV-2026-${TENANT_A.slice(0, 8)}`,
        kind: InvoiceKind.INVOICE,
        student_id: student.id,
        payment_id: payment.id,
        total_amount: 1500,
        tax_amount: 0,
        discount_amount: 0,
        status: InvoiceStatus.PAID,
        issued_date: '2026-01-05',
        due_date: '2026-01-10',
        snapshot: {
          issuer: { name: 'Fixture School', captured_at: '2026-01-05T00:00:00.000Z' },
          students: [
            {
              id: student.id,
              full_name: 'Fixture Student',
              registration_number: 'REG-FIXTURE',
              class_name: null,
              lines: [
                {
                  fee_name: 'Tuition - January',
                  period_label: '2026-01',
                  amount: 1500,
                  discount: 0,
                  paid_this_time: 1500,
                  balance_after: 0,
                },
              ],
            },
          ],
          totals: {
            billed: 1500,
            discount: 0,
            paid: 1500,
            change: 0,
            wallet_used: 0,
            wallet_added: 0,
          },
          payment: {
            method: PaymentMethod.CASH,
            reference: null,
            received_by_name: null,
            payment_date: '2026-01-05',
          },
        },
        issued_by_user_id: USER_ID,
        notes: null,
      }),
    );

    // Back-link the payment to the invoice it produced. `Payment` carries
    // no immutability trigger, so a plain UPDATE is fine here.
    await dataSource.getRepository(Payment).update({ id: payment.id }, { invoice_id: invoice.id });

    await dataSource.getRepository(PaymentAllocation).save(
      dataSource.getRepository(PaymentAllocation).create({
        payment_id: payment.id,
        student_fee_id: studentFee.id,
        allocated_amount: 1500,
        allocation_type: PaymentAllocationType.CURRENT,
        notes: null,
      }),
    );

    // One grading scale carrying `revision` above 1 (D6: restore must
    // preserve it, not reset it to the entity's `default: 1`), plus two
    // bands — one with a real `gpa`, one with `gpa: null` (D4: a letter-only
    // band never computes one) — so both cases hit the round trip.
    const scale = await dataSource.getRepository(GradingScale).save(
      dataSource.getRepository(GradingScale).create({
        tenant_id: TENANT_A,
        academic_year_id: year.id,
        class_id: null,
        name: 'BD NCTB',
        revision: 3,
      }),
    );
    await dataSource.getRepository(GradingBand).save([
      dataSource.getRepository(GradingBand).create({
        tenant_id: TENANT_A,
        scale_id: scale.id,
        percent_from: 80,
        percent_to: 100,
        grade: 'A+',
        gpa: '5.00',
        is_fail: false,
        sequence: 1,
        comment: null,
      }),
      dataSource.getRepository(GradingBand).create({
        tenant_id: TENANT_A,
        scale_id: scale.id,
        percent_from: 0,
        percent_to: 32,
        grade: 'F',
        gpa: null,
        is_fail: true,
        sequence: 2,
        comment: null,
      }),
    ]);
    // --- Epic 21.0 (class routine/timetable): [21.11.1] round-trip
    // coverage. Exercises the naive-codec traps a plain flatten would miss:
    // a biweekly slot (recurrence_offset = 1), a monthly slot on the last
    // occurrence (offset = -1), a co-taught slot (two `routine_slot_teachers`
    // rows), a superseded slot (`valid_to` set), and a cancellation
    // substitution with a null substitute teacher.
    const secondSection = await dataSource
      .getRepository(ClassSection)
      .findOneOrFail({ where: { tenant_id: TENANT_A, class_id: klass.id, section_name: 'B' } });

    const routineSubject = await dataSource.getRepository(Subject).save(
      dataSource.getRepository(Subject).create({
        name_en: 'Mathematics',
        code: 'MATH',
        tenant_id: TENANT_A,
      }),
    );

    const teacherUserOne = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `roundtrip-610-teacher1-${TENANT_A.slice(0, 8)}@test.com`,
        full_name: 'Roundtrip Teacher One',
        password_hash: 'not-the-asserted-hash',
      }),
    );
    const teacherUserTwo = await dataSource.getRepository(User).save(
      dataSource.getRepository(User).create({
        email: `roundtrip-610-teacher2-${TENANT_A.slice(0, 8)}@test.com`,
        full_name: 'Roundtrip Teacher Two',
        password_hash: 'not-the-asserted-hash',
      }),
    );
    // `users` tab loads members via `user_tenants` (see users.tab.ts's
    // `load`) — a teacher's User needs the same membership row admin/
    // operator got above, or it exports as zero rows.
    await dataSource
      .getRepository(UserTenant)
      .save([
        dataSource
          .getRepository(UserTenant)
          .create({ user_id: teacherUserOne.id, tenant_id: TENANT_A, role: UserRole.TEACHER }),
        dataSource
          .getRepository(UserTenant)
          .create({ user_id: teacherUserTwo.id, tenant_id: TENANT_A, role: UserRole.TEACHER }),
      ]);

    const teacherOne = await dataSource.getRepository(Teacher).save(
      dataSource.getRepository(Teacher).create({
        user_id: teacherUserOne.id,
        employee_id: `EMP-610-1-${TENANT_A.slice(0, 6)}`,
        designations: [TeacherDesignation.SUBJECT_TEACHER],
        tenant_id: TENANT_A,
      }),
    );
    const teacherTwo = await dataSource.getRepository(Teacher).save(
      dataSource.getRepository(Teacher).create({
        user_id: teacherUserTwo.id,
        employee_id: `EMP-610-2-${TENANT_A.slice(0, 6)}`,
        designations: [TeacherDesignation.SUBJECT_TEACHER],
        tenant_id: TENANT_A,
      }),
    );

    const shift = await dataSource.getRepository(Shift).save(
      dataSource.getRepository(Shift).create({
        name: 'Morning',
        day_starts_at: '08:00:00',
        day_ends_at: '13:30:00',
        sequence: 1,
        tenant_id: TENANT_A,
      }),
    );

    // Six period slots, including one BREAK ("Lunch") — the seed spec's own
    // shape (D8/D10), reused here for the round-trip fixture.
    const periodDefs: Array<{
      sequence: number;
      kind: PeriodSlotKind;
      name: string | null;
      starts_at: string;
      ends_at: string;
    }> = [
      {
        sequence: 1,
        kind: PeriodSlotKind.CLASS,
        name: null,
        starts_at: '08:00:00',
        ends_at: '08:40:00',
      },
      {
        sequence: 2,
        kind: PeriodSlotKind.CLASS,
        name: null,
        starts_at: '08:40:00',
        ends_at: '09:20:00',
      },
      {
        sequence: 3,
        kind: PeriodSlotKind.CLASS,
        name: null,
        starts_at: '09:20:00',
        ends_at: '10:00:00',
      },
      {
        sequence: 4,
        kind: PeriodSlotKind.BREAK,
        name: 'Lunch',
        starts_at: '10:00:00',
        ends_at: '10:30:00',
      },
      {
        sequence: 5,
        kind: PeriodSlotKind.CLASS,
        name: null,
        starts_at: '10:30:00',
        ends_at: '11:10:00',
      },
      {
        sequence: 6,
        kind: PeriodSlotKind.CLASS,
        name: null,
        starts_at: '11:10:00',
        ends_at: '11:50:00',
      },
    ];
    const periodSlots = await dataSource
      .getRepository(PeriodSlot)
      .save(
        periodDefs.map((p) =>
          dataSource
            .getRepository(PeriodSlot)
            .create({ ...p, shift_id: shift.id, tenant_id: TENANT_A }),
        ),
      );

    const room = await dataSource.getRepository(Room).save(
      dataSource.getRepository(Room).create({
        building: 'Building A',
        room_no: '204',
        capacity: 40,
        tenant_id: TENANT_A,
      }),
    );

    const routine = await dataSource.getRepository(Routine).save(
      dataSource.getRepository(Routine).create({
        academic_year_id: year.id,
        name: 'Main routine',
        state: RoutineState.PUBLISHED,
        published_at: new Date('2026-01-01T00:00:00.000Z'),
        tenant_id: TENANT_A,
      }),
    );

    // A superseded row: this slot ended, and a fresh row (created below)
    // covers the same section/period/weekday from the day after.
    const supersededSlot = await dataSource.getRepository(RoutineSlot).save(
      dataSource.getRepository(RoutineSlot).create({
        routine_id: routine.id,
        section_id: section.id,
        period_slot_id: periodSlots[0]!.id,
        weekday: 1,
        subject_id: routineSubject.id,
        room_id: room.id,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: '2026-02-01',
        tenant_id: TENANT_A,
      }),
    );

    const currentSlot = await dataSource.getRepository(RoutineSlot).save(
      dataSource.getRepository(RoutineSlot).create({
        routine_id: routine.id,
        section_id: section.id,
        period_slot_id: periodSlots[0]!.id,
        weekday: 1,
        subject_id: routineSubject.id,
        room_id: room.id,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2026-02-02',
        valid_to: null,
        tenant_id: TENANT_A,
      }),
    );

    // Biweekly slot, occurring on the second week of the cycle.
    const biweeklySlot = await dataSource.getRepository(RoutineSlot).save(
      dataSource.getRepository(RoutineSlot).create({
        routine_id: routine.id,
        section_id: section.id,
        period_slot_id: periodSlots[1]!.id,
        weekday: 2,
        subject_id: routineSubject.id,
        room_id: null,
        recurrence: SlotRecurrence.BIWEEKLY,
        recurrence_offset: 1,
        valid_from: '2026-01-01',
        valid_to: null,
        tenant_id: TENANT_A,
      }),
    );

    // Monthly slot on the last occurrence of the cycle.
    const monthlySlot = await dataSource.getRepository(RoutineSlot).save(
      dataSource.getRepository(RoutineSlot).create({
        routine_id: routine.id,
        section_id: section.id,
        period_slot_id: periodSlots[2]!.id,
        weekday: 3,
        subject_id: routineSubject.id,
        room_id: null,
        recurrence: SlotRecurrence.MONTHLY,
        recurrence_offset: -1,
        valid_from: '2026-01-01',
        valid_to: null,
        tenant_id: TENANT_A,
      }),
    );

    // Co-taught slot, second section: two teachers on the same slot.
    const coTaughtSlot = await dataSource.getRepository(RoutineSlot).save(
      dataSource.getRepository(RoutineSlot).create({
        routine_id: routine.id,
        section_id: secondSection.id,
        period_slot_id: periodSlots[4]!.id,
        weekday: 1,
        subject_id: routineSubject.id,
        room_id: room.id,
        recurrence: SlotRecurrence.WEEKLY,
        recurrence_offset: 0,
        valid_from: '2026-01-01',
        valid_to: null,
        tenant_id: TENANT_A,
      }),
    );

    await dataSource.getRepository(RoutineSlotTeacher).save([
      dataSource.getRepository(RoutineSlotTeacher).create({
        routine_slot_id: currentSlot.id,
        teacher_id: teacherOne.id,
        tenant_id: TENANT_A,
      }),
      dataSource.getRepository(RoutineSlotTeacher).create({
        routine_slot_id: coTaughtSlot.id,
        teacher_id: teacherOne.id,
        tenant_id: TENANT_A,
      }),
      dataSource.getRepository(RoutineSlotTeacher).create({
        routine_slot_id: coTaughtSlot.id,
        teacher_id: teacherTwo.id,
        tenant_id: TENANT_A,
      }),
      dataSource.getRepository(RoutineSlotTeacher).create({
        routine_slot_id: biweeklySlot.id,
        teacher_id: teacherOne.id,
        tenant_id: TENANT_A,
      }),
      dataSource.getRepository(RoutineSlotTeacher).create({
        routine_slot_id: monthlySlot.id,
        teacher_id: teacherOne.id,
        tenant_id: TENANT_A,
      }),
      dataSource.getRepository(RoutineSlotTeacher).create({
        routine_slot_id: supersededSlot.id,
        teacher_id: teacherOne.id,
        tenant_id: TENANT_A,
      }),
    ]);

    // Cancellation: `is_cancelled = true`, `substitute_teacher_id = null`.
    await dataSource.getRepository(RoutineSubstitution).save(
      dataSource.getRepository(RoutineSubstitution).create({
        routine_slot_id: currentSlot.id,
        date: '2026-02-09',
        substitute_teacher_id: null,
        is_cancelled: true,
        reason: 'Teacher on leave, period cancelled outright',
        created_by: USER_ID,
        tenant_id: TENANT_A,
      }),
    );

    await dataSource.getRepository(RoutineChangeRequest).save(
      dataSource.getRepository(RoutineChangeRequest).create({
        routine_slot_id: currentSlot.id,
        requested_by: USER_ID,
        note: 'Requesting a swap with the next free period',
        state: ChangeRequestState.OPEN,
        resolved_by: null,
        resolved_at: null,
        resolution_note: null,
        tenant_id: TENANT_A,
      }),
    );

    // --- Exams/marks/results spine (19.10.1, #906) -----------------------
    // Two students so `marks` carries two rows against the same component,
    // one PRESENT and one ABSENT (D10).
    const students = await dataSource
      .getRepository(Student)
      .find({ where: { tenant_id: TENANT_A }, take: 2 });
    expect(
      students.length,
      'fixture needs at least 2 students for the marks case',
    ).toBeGreaterThanOrEqual(2);
    const [studentOne, studentTwo] = students;

    const subject = await dataSource.getRepository(Subject).save(
      dataSource.getRepository(Subject).create({
        tenant_id: TENANT_A,
        name_en: 'Mathematics',
        name_bn: 'গণিত',
        code: `MATH-${TENANT_A.slice(0, 8)}`,
      }),
    );

    const classSubject = await dataSource.getRepository(ClassSubject).save(
      dataSource.getRepository(ClassSubject).create({
        tenant_id: TENANT_A,
        class_id: klass.id,
        subject_id: subject.id,
        academic_year_id: year.id,
      }),
    );

    const exam = await dataSource.getRepository(Exam).save(
      dataSource.getRepository(Exam).create({
        tenant_id: TENANT_A,
        academic_year_id: year.id,
        class_id: klass.id,
        academic_term_id: null,
        name: 'First Term Exam',
        kind: ExamKind.TERM,
        status: ExamStatus.PROCESSED,
        published_at: null,
      }),
    );

    const component = await dataSource.getRepository(ExamComponent).save(
      dataSource.getRepository(ExamComponent).create({
        tenant_id: TENANT_A,
        exam_id: exam.id,
        subject_id: subject.id,
        name: 'Written',
        kind: ExamComponentKind.WRITTEN,
        source: ExamComponentSource.MANUAL,
        full_marks: '100.00',
        pass_marks: '33.00',
        sequence: 1,
      }),
    );

    await dataSource.getRepository(MarkGrid).save(
      dataSource.getRepository(MarkGrid).create({
        tenant_id: TENANT_A,
        exam_id: exam.id,
        section_id: section.id,
        subject_id: subject.id,
        state: MarkGridState.SUBMITTED,
        submitted_by: USER_ID,
        submitted_at: new Date('2026-02-01T00:00:00.000Z'),
      }),
    );

    // D10: a PRESENT mark carries a value; an ABSENT mark's `value` must be
    // (and must round-trip as) `null` — never a coerced zero.
    await dataSource.getRepository(Mark).save([
      dataSource.getRepository(Mark).create({
        tenant_id: TENANT_A,
        exam_id: exam.id,
        student_id: studentOne.id,
        subject_id: subject.id,
        component_id: component.id,
        value: '78.50',
        status: MarkStatus.PRESENT,
        entered_by: USER_ID,
      }),
      dataSource.getRepository(Mark).create({
        tenant_id: TENANT_A,
        exam_id: exam.id,
        student_id: studentTwo.id,
        subject_id: subject.id,
        component_id: component.id,
        value: null,
        status: MarkStatus.ABSENT,
        entered_by: USER_ID,
      }),
    ]);

    // D19: a published result pins the scale's revision and the rule
    // version that produced it — the round trip must preserve both exactly.
    const result = await dataSource.getRepository(Result).save(
      dataSource.getRepository(Result).create({
        tenant_id: TENANT_A,
        exam_id: exam.id,
        student_id: studentOne.id,
        total_marks: '78.50',
        gpa: '4.50',
        grade: 'A',
        position: 1,
        is_fail: false,
        grading_scale_id: scale.id,
        grading_scale_revision: scale.revision,
        rule_version: 'nctb-2026.1',
        computed_at: new Date('2026-02-10T00:00:00.000Z'),
        published_at: new Date('2026-02-11T00:00:00.000Z'),
      }),
    );

    await dataSource.getRepository(ResultSubject).save(
      dataSource.getRepository(ResultSubject).create({
        tenant_id: TENANT_A,
        result_id: result.id,
        subject_id: subject.id,
        obtained: '78.50',
        grade: 'A',
        gpa: '4.50',
        is_fail: false,
        is_fourth_subject: false,
      }),
    );

    await dataSource.getRepository(StudentSubjectChoice).save(
      dataSource.getRepository(StudentSubjectChoice).create({
        tenant_id: TENANT_A,
        student_id: studentOne.id,
        class_subject_id: classSubject.id,
        academic_year_id: year.id,
        is_fourth: true,
      }),
    );

    // [19.11.1] exam_schedules — one row with a venue, one with a null
    // venue, so the round trip covers the nullable column explicitly.
    await dataSource.getRepository(ExamSchedule).save([
      dataSource.getRepository(ExamSchedule).create({
        tenant_id: TENANT_A,
        exam_id: exam.id,
        subject_id: subject.id,
        date: '2026-02-05',
        starts_at: '09:00:00',
        ends_at: '11:00:00',
        venue: 'Main Hall',
      }),
    ]);
    const secondSubject = await dataSource.getRepository(Subject).save(
      dataSource.getRepository(Subject).create({
        tenant_id: TENANT_A,
        name_en: 'English',
        name_bn: 'ইংরেজি',
        code: `ENG-${TENANT_A.slice(0, 8)}`,
      }),
    );
    await dataSource.getRepository(ExamSchedule).save([
      dataSource.getRepository(ExamSchedule).create({
        tenant_id: TENANT_A,
        exam_id: exam.id,
        subject_id: secondSubject.id,
        date: '2026-02-06',
        starts_at: '09:00:00',
        ends_at: '11:00:00',
        venue: null,
      }),
    ]);
  }

  /**
   * Fails loudly if the fixture did not actually reach the workbook.
   *
   * The round-trip equality assertion is vacuous on empty sheets: two
   * workbooks with nothing in them are trivially equal. This guard names the
   * tabs the fixture is *supposed* to populate, so "the seed silently stopped
   * working" fails here with a readable message instead of passing as a green
   * round trip. Tabs the fixture deliberately does not cover
   * (`subjects`, `class_subjects`, `holidays`, `teachers`,
   * `teacher_assignments`) are listed as a known gap rather than asserted.
   */
  function assertFixtureIsMeaty(rowCounts: Record<string, number | undefined>): void {
    const mustBeNonEmpty = [
      'school',
      'academic_years',
      'classes',
      'sections',
      'users',
      'guardians',
      'students',
      'enrollments',
      'fee_structures',
      'student_fees',
      'invoices',
      'payments',
      'payment_allocations',
      'grading_scales',
      'grading_bands',
      // Epic 21.0 (class routine/timetable), [21.11.1].
      'shifts',
      'period_slots',
      'rooms',
      'routines',
      'routine_slots',
      'routine_slot_teachers',
      'routine_substitutions',
      'routine_change_requests',
      'exams',
      'exam_components',
      'exam_schedules',
      'mark_grids',
      'marks',
      'results',
      'result_subjects',
      'student_subject_choices',
    ];
    const empty = mustBeNonEmpty.filter((tab) => !(rowCounts[tab] ?? 0));
    expect(empty, `fixture produced no rows for: ${empty.join(', ')}`).toEqual([]);
  }

  afterAll(async () => {
    // Order matters, and a hand-written per-repository delete list gets it
    // wrong as soon as the fixture grows: this spec seeds both tenants'
    // transactional tables (students, enrollments, the fee chain), and those
    // rows hold FKs onto the reference tables (`class_sections`, `classes`,
    // `academic_years`) cleaned up below. Deleting a parent first is a
    // foreign-key violation, and several of the child tables
    // (`student_fees`, `invoices`, `payment_allocations`) have no `tenant_id`
    // of their own to delete by anyway.
    //
    // So reuse the suite's own child-first sweep, `buildResetSql()` from
    // `test/reset-order.ts`, which covers every transactional table in
    // dependency order — including `workbook_jobs` and the `TRUNCATE` of
    // append-only `audit_logs`. Truncating `audit_logs` first is also what
    // makes deleting `schools`/`users` below safe: `audit_logs`' FK to
    // `users` is `ON DELETE SET NULL` (an UPDATE the append-only trigger
    // would reject) and its FK to `schools` is `ON DELETE RESTRICT`.
    //
    // Not wrapped in try/catch, deliberately: a failure here is a real
    // schema or ordering problem and must fail the run, not be swallowed.
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();
    try {
      await queryRunner.query(buildResetSql());
    } finally {
      await queryRunner.release();
    }

    for (const tenantId of [TENANT_A, TENANT_B]) {
      await dataSource.getRepository(ClassSection).delete({ tenant_id: tenantId });
      await dataSource.getRepository(Class).delete({ tenant_id: tenantId });
      await dataSource.getRepository(AcademicYear).delete({ tenant_id: tenantId });
      await dataSource.getRepository(UserTenant).delete({ tenant_id: tenantId });
      await dataSource.getRepository(School).delete({ id: tenantId });
    }
    await dataSource.getRepository(User).delete({ id: USER_ID });
    await dataSource.getRepository(User).delete({ id: OPERATOR_ID });
  });

  it('export A -> wipe A -> validate/diff against empty B -> restore into B -> export B -> normalized workbooks are equal, and no secret leaks', async () => {
    const start = Date.now();

    // --- 0. Seed tenant A (in the test body, not beforeAll — see
    // `seedFixture`'s docblock) ------------------------------------------
    await seedFixture();

    // --- 1. Export A---------------------------------------------------
    const jobA = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: TENANT_A,
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: null,
      }),
    );
    await exportProcessor.process(fakeExportJob(jobA.id, TENANT_A));
    const finishedA = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: jobA.id } });
    expect(finishedA.status).toBe(WorkbookJobStatus.DONE);
    const bufferA = storage.objects.get(finishedA.storage_key as string) as Buffer;
    expect(bufferA).toBeTruthy();
    // Guard first: an empty fixture makes every assertion below vacuous.
    assertFixtureIsMeaty((finishedA.row_counts ?? {}) as Record<string, number>);

    // --- 1b. Tear tenant A down -----------------------------------------
    // Not optional, and not a convenience: several natural keys the
    // workbook round-trips on carry **global** unique constraints, not
    // tenant-scoped ones — `students.registration_number`
    // (`UQ_82946fdb5652b83cacb81e9083e`), `teachers.employee_id`,
    // `users.email`, `Student.user_id`. The restore tabs check them
    // deliberately (see `students.tab.ts`'s `upsert`) and refuse to move a
    // row between tenants:
    //
    //   Student with registration number "2026-2027-0001" already exists
    //   in tenant "<A>" and cannot be restored into tenant "<B>".
    //
    // So "export A and restore it into a *different* live tenant B" is not
    // a scenario the product supports, and a spine test must not assert it.
    // What restore actually supports — and what this test therefore models
    // — is disaster recovery: the source tenant's data is gone, and the
    // workbook puts it back. Wiping A here is what makes B genuinely empty
    // in the only sense that matters, namely that nothing anywhere still
    // holds A's globally-unique identifiers.
    //
    // `bufferA` is already captured above, so the workbook under test is
    // unaffected by this teardown.
    {
      const runner = dataSource.createQueryRunner();
      await runner.connect();
      try {
        await runner.query(buildResetSql());
      } finally {
        await runner.release();
      }
      await dataSource.getRepository(ClassSection).delete({ tenant_id: TENANT_A });
      await dataSource.getRepository(Class).delete({ tenant_id: TENANT_A });
      await dataSource.getRepository(AcademicYear).delete({ tenant_id: TENANT_A });
      await dataSource.getRepository(UserTenant).delete({ tenant_id: TENANT_A });
      // `users.email` is globally unique too, and the `users` tab recreates
      // the member in B from the workbook (without the password hash, which
      // `users.tab.ts` excludes by design).
      await dataSource.getRepository(User).delete({ id: USER_ID });
    }

    // --- 2. Validate + diff against empty B (C3) ------------------------
    const validated = await validationService.validate(bufferA, TENANT_B, dataSource.manager);
    const hardErrors = validated.errors.filter((e) => e.severity === 'error');
    expect(hardErrors).toEqual([]);
    expect(validated.hardErrorCount).toBe(0);

    const report = await diffService.diff(validated, TENANT_B, dataSource.manager);
    expect(report.isEmptyTenant).toBe(true);
    // Every row in A's export should show up as a create against empty B.
    const expectedCreates = Object.values(finishedA.row_counts ?? {}).reduce(
      (sum, n) => sum + (n ?? 0),
      0,
    );
    expect(report.totals.creates).toBe(expectedCreates);

    // --- 3. Restore bufferA into B --------------------------------------
    const stagingKey = `staging/${randomUUID()}.xlsx`;
    await storage.put(stagingKey, bufferA);
    const { stagingId } = await staging.stage(TENANT_B, OPERATOR_ID, {
      workbook_storage_key: stagingKey,
      meta: {},
      tabs: [],
      totals: { creates: 0, updates: 0, unchanged: 0, deletes: 0 },
      hardErrorCount: 0,
      isEmptyTenant: true,
      errors: [],
      warnings: [],
    });

    const snapshotJob = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: TENANT_B,
        kind: WorkbookJobKind.SNAPSHOT,
        source: WorkbookJobSource.SNAPSHOT,
        status: WorkbookJobStatus.DONE,
        requested_by_user_id: OPERATOR_ID,
      }),
    );
    const restoreJob = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: TENANT_B,
        kind: WorkbookJobKind.RESTORE,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: OPERATOR_ID,
        staging_id: stagingId,
        snapshot_job_id: snapshotJob.id,
      }),
    );

    await restoreProcessor.process(fakeRestoreJob(restoreJob.id));

    const finishedRestore = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: restoreJob.id } });
    expect(finishedRestore.status).toBe(WorkbookJobStatus.DONE);
    expect(finishedRestore.failed_tab).toBeNull();

    // --- 4. Export B -----------------------------------------------------
    const jobB = await dataSource.getRepository(WorkbookJob).save(
      dataSource.getRepository(WorkbookJob).create({
        tenant_id: TENANT_B,
        kind: WorkbookJobKind.EXPORT,
        source: WorkbookJobSource.MANUAL,
        status: WorkbookJobStatus.QUEUED,
        requested_by_user_id: null,
      }),
    );
    await exportProcessor.process(fakeExportJob(jobB.id, TENANT_B));
    const finishedB = await dataSource
      .getRepository(WorkbookJob)
      .findOneOrFail({ where: { id: jobB.id } });
    expect(finishedB.status).toBe(WorkbookJobStatus.DONE);
    const bufferB = storage.objects.get(finishedB.storage_key as string) as Buffer;
    expect(bufferB).toBeTruthy();

    // --- 5. Compare, normalized -------------------------------------------
    const resultA = await readWorkbook(bufferA);
    const resultB = await readWorkbook(bufferB);
    const normalizedA = normalizeWorkbook(resultA, ALL_TABS);
    const normalizedB = normalizeWorkbook(resultB, ALL_TABS);

    // `school.name` is the one legitimate exception to "the two exports
    // must match": it is the destination tenant's own identity, which a
    // restore must never overwrite (see `school.tab.ts`'s `upsert`).
    // A's export genuinely says "Roundtrip Test School A"; B's re-export
    // genuinely still says B's own name. Assert that divergence explicitly
    // — the same way `_meta` is handled below — then drop just that one
    // cell before the general equality check, so a real regression in any
    // other column still fails loudly.
    expect(normalizedA.school?.[0]?.name).toBe('Roundtrip Test School A');
    expect(normalizedB.school?.[0]?.name).toBe('Roundtrip Test School B (empty)');

    // [33.5.1] `settings.organisation` is folded into the generic equality
    // check below like any other column, but assert it explicitly too: it
    // is the one settings key this fixture actually varies, so a passing
    // generic diff would otherwise prove nothing about `stripSecretPaths` /
    // `deepMergePresent` (school.tab.ts) actually preserving it intact
    // through export → strip → re-import → merge.
    const organisationA = JSON.parse(normalizedA.school?.[0]?.settings ?? '{}').organisation;
    const organisationB = JSON.parse(normalizedB.school?.[0]?.settings ?? '{}').organisation;
    expect(organisationA).toEqual(DEMO_ORGANISATION);
    expect(organisationB).toEqual(DEMO_ORGANISATION);

    const normalizedANoName = {
      ...normalizedA,
      school: normalizedA.school?.map(({ name: _name, ...rest }) => rest),
    };
    const normalizedBNoName = {
      ...normalizedB,
      school: normalizedB.school?.map(({ name: _name, ...rest }) => rest),
    };

    const diffLines = diffNormalized(normalizedANoName, normalizedBNoName);
    expect(diffLines).toEqual([]);
    expect(normalizedBNoName).toEqual(normalizedANoName);

    // (D6) explicit, beyond the generic diff above: restoring a scale whose
    // `revision` sat above the entity's `default: 1` must not silently reset
    // it — a fresh `GradingScale()` created by restore defaults to 1, and
    // only `gradingScalesTab.upsert` writing the restored value back
    // prevents that from winning.
    const restoredScale = await dataSource
      .getRepository(GradingScale)
      .findOneOrFail({ where: { tenant_id: TENANT_B, name: 'BD NCTB' } });
    expect(restoredScale.revision).toBe(3);

    // (D4) explicit: a letter-only band's `gpa` must restore as `null`, not
    // fall back to `0.00` or any other placeholder.
    const restoredFailBand = await dataSource
      .getRepository(GradingBand)
      .findOneOrFail({ where: { scale_id: restoredScale.id, grade: 'F' } });
    expect(restoredFailBand.gpa).toBeNull();

    // (D10) explicit, beyond the generic diff above: an ABSENT mark's
    // `value` must restore as `null`, never a coerced zero — a real
    // data-integrity bug the ticket calls out by name.
    const restoredAbsentMark = await dataSource
      .getRepository(Mark)
      .findOneOrFail({ where: { tenant_id: TENANT_B, status: MarkStatus.ABSENT } });
    expect(restoredAbsentMark.value).toBeNull();
    const restoredPresentMark = await dataSource
      .getRepository(Mark)
      .findOneOrFail({ where: { tenant_id: TENANT_B, status: MarkStatus.PRESENT } });
    expect(restoredPresentMark.value).toBe('78.50');

    // (D19) explicit: a published result's pinned `grading_scale_revision`
    // and `rule_version` must restore exactly, not re-derive from the
    // referenced scale's current row — losing the pin would let a later
    // grading-scale edit silently re-grade an already-printed result.
    const restoredResult = await dataSource
      .getRepository(Result)
      .findOneOrFail({ where: { tenant_id: TENANT_B } });
    expect(restoredResult.grading_scale_revision).toBe(3);
    expect(restoredResult.rule_version).toBe('nctb-2026.1');
    expect(restoredResult.published_at).not.toBeNull();

    // `_meta` is *expected* to differ — assert that explicitly rather
    // than ignoring it.
    expect(resultA.meta.schema_version).toBe(SCHEMA_VERSION);
    expect(resultB.meta.schema_version).toBe(SCHEMA_VERSION);
    expect(resultB.meta.source_school_name).toBe('Roundtrip Test School B (empty)');
    expect(resultA.meta.source_school_name).not.toBe(resultB.meta.source_school_name);

    // --- 6. Leak scan (C5) -------------------------------------------------
    // An .xlsx is a DEFLATE zip, so scanning `buffer.toString('latin1')`
    // finds nothing — not even strings that are definitely in the workbook.
    // A `not.toContain` over the compressed bytes therefore passes
    // unconditionally and proves nothing. Unzip and scan the decompressed
    // entries (sheet XML + the shared-string table, where cell text
    // actually lives), exactly as the issue body's step 3 specifies.
    for (const [label, buffer] of [
      ['A', bufferA],
      ['B', bufferB],
    ] as const) {
      const zip = await JSZip.loadAsync(buffer);
      const parts = await Promise.all(
        Object.values(zip.files)
          .filter((f) => !f.dir)
          .map((f) => f.async('string')),
      );
      const plain = parts.join('\n');

      // Positive control: this string *is* in the workbook, so if the scan
      // can't find it the scan itself is broken and the three assertions
      // below would be worthless. Without this, a future change to the
      // archive format silently turns the leak check back into a no-op.
      expect(plain, `${label}: leak scan is not reading workbook text`).toContain(
        label === 'A' ? 'Roundtrip Test School A' : 'Roundtrip Test School B (empty)',
      );

      expect(plain, `${label}: provider secret leaked`).not.toContain(PROVIDER_SECRET);
      expect(plain, `${label}: seeded password leaked`).not.toContain(SEEDED_PASSWORD_HASH);
      expect(plain, `${label}: SEED_DEVICE_KEY leaked`).not.toContain(SEED_DEVICE_KEY);
    }

    // eslint-disable-next-line no-console
    console.log(`workbook round trip took ${Date.now() - start}ms`);
  }, 90_000);
});
