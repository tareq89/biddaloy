import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter } from 'node:events';
import { Repository, IsNull, In, EntityManager } from 'typeorm';
import { Student } from '../students/entities/student.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { School } from '../schools/entities/school.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeGeneration } from './entities/fee-generation.entity';
import { StudentWallet } from './entities/student-wallet.entity';
import { resolveTenantSettings } from '../schools/settings/tenant-settings-resolver';
import {
  EnrollmentStatus,
  FeeStatus,
  PeriodType,
  DuplicateStrategy,
  FeeGenerationSource,
  WalletTransactionKind,
  AuditAction,
  ApprovalScope,
} from '@biddaloy/shared';
import {
  GenerateFeesPreviewDto,
  GenerateFeesDto,
  GenerateFeesPreviewResultDto,
  GenerateFeesResultDto,
  InactiveStudentDto,
  DuplicateBillDto,
} from './dto/fees.dto';
import { FeeGenerationsService } from './fee-generations.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../auth/guards/approval.guard';

/**
 * [16.3.1] Resolves the discount (if any) applied to one student × fee
 * structure pair at generation time. Real discount rules land in 16.7.3;
 * `NoopDiscountResolver` below is the discount-free default until then.
 */
export interface DiscountResolver {
  resolve(context: {
    tenantId: string;
    studentId: string;
    feeStructureId: string;
    baseAmount: number;
  }): Promise<{ amount: number }>;
}

/** Default `DiscountResolver`: no discounts apply. Real rules land in
 * 16.7.3 — this keeps `standing_discount_amount` correct (0) until then. */
@Injectable()
export class NoopDiscountResolver implements DiscountResolver {
  resolve(_context: {
    tenantId: string;
    studentId: string;
    feeStructureId: string;
    baseAmount: number;
  }): Promise<{ amount: number }> {
    return Promise.resolve({ amount: 0 });
  }
}

/** Node's `events` module, not `@nestjs/event-emitter` — that package is
 * not a dependency of this repo (same correction as [14.7.3]'s
 * `WorkbookJobEventsService`). A plain exported singleton, not a Nest
 * provider, so this file's rewrite doesn't have to touch `fees.module.ts`
 * (outside this ticket's stated territory) to register it. */
export const FEES_GENERATED_EVENT = 'fees.generated';
export interface FeesGeneratedEventPayload {
  tenantId: string;
  feeGenerationId: string;
}
class FeesEventEmitter extends EventEmitter {}
export const feesEvents = new FeesEventEmitter();
feesEvents.setMaxListeners(50);

const DUPLICATE_OVERRIDE_SCOPE = ApprovalScope.FEES_DUPLICATE_OVERRIDE;

interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
  currentTenant?: { id: string };
  user?: { sub: string };
}

interface LoadedContext {
  academicYear: AcademicYear;
  structures: FeeStructure[];
  activeStudents: Student[];
  inactiveStudents: Student[];
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Generates exactly what the user picked — these students × these fees ×
 * this period — replacing the old implicit class/section-based run.
 *
 * `preview()` is read-only. `generate()` writes everything inside one
 * transaction: re-validates, creates the `FeeGeneration` batch (via
 * `FeeGenerationsService.create`), inserts one `StudentFee` bill per
 * (student, fee structure) pair not skipped by the duplicate strategy,
 * auto-applies each student's wallet balance against their new bills, then
 * — only after the transaction has committed — emits `fees.generated` if
 * the tenant wants families notified.
 */
@Injectable()
export class FeeGenerationService {
  constructor(
    @InjectRepository(Student)
    private readonly studentRepo: Repository<Student>,
    @InjectRepository(StudentFee)
    private readonly studentFeeRepo: Repository<StudentFee>,
    @InjectRepository(School)
    private readonly schoolRepo: Repository<School>,
    private readonly feeGenerationsService: FeeGenerationsService,
    private readonly walletService: WalletService,
    private readonly auditService: AuditService,
    private readonly approvalService: ApprovalService,
    private readonly discountResolver: NoopDiscountResolver,
  ) {}

  async preview(
    dto: GenerateFeesPreviewDto,
    tenantId: string,
  ): Promise<GenerateFeesPreviewResultDto> {
    const context = await this.loadContext(dto, tenantId, this.studentRepo.manager);

    const duplicates = await this.findDuplicates(
      context.activeStudents
        .map((s) => s.id)
        .concat(dto.include_inactive ? context.inactiveStudents.map((s) => s.id) : []),
      dto.fee_structure_ids,
      context.periodStart,
      this.studentRepo.manager,
    );
    const duplicateKeys = new Set(duplicates.map((d) => `${d.student_id}:${d.fee_structure_id}`));

    const targetStudents = dto.include_inactive
      ? [...context.activeStudents, ...context.inactiveStudents]
      : context.activeStudents;

    let wouldGenerate = 0;
    for (const student of targetStudents) {
      for (const structure of context.structures) {
        if (!duplicateKeys.has(`${student.id}:${structure.id}`)) {
          wouldGenerate += 1;
        }
      }
    }

    return {
      students_total: dto.student_ids.length,
      inactive: context.inactiveStudents.map(toInactiveDto),
      duplicates: duplicates.map(
        ({ student_id, fee_structure_id, existing_bill_id, paid_amount }) => ({
          student_id,
          fee_structure_id,
          existing_bill_id,
          paid_amount,
        }),
      ),
      would_generate: wouldGenerate,
    };
  }

  async generate(
    dto: GenerateFeesDto,
    tenantId: string,
    userId: string | null,
    request: RequestLike,
  ): Promise<GenerateFeesResultDto> {
    const duplicateStrategy = dto.duplicate_strategy ?? DuplicateStrategy.SKIP;
    const notifyFamilies = await this.resolveNotifyFamilies(dto, tenantId);

    let feeGenerationId = '';
    let generatedCount = 0;
    let skippedCount = 0;
    let removedCount = 0;
    let inactiveSkipped: InactiveStudentDto[] = [];
    let studentCount = 0;

    await this.studentFeeRepo.manager.transaction(async (manager) => {
      const context = await this.loadContext(dto, tenantId, manager);
      inactiveSkipped = context.inactiveStudents.map(toInactiveDto);
      const targetStudents = dto.include_inactive
        ? [...context.activeStudents, ...context.inactiveStudents]
        : context.activeStudents;
      studentCount = targetStudents.length;

      const duplicates = await this.findDuplicates(
        targetStudents.map((s) => s.id),
        dto.fee_structure_ids,
        context.periodStart,
        manager,
      );
      // Group by student/structure pair — a pair can already have more than
      // one stacked bill from a prior CREATE_ANYWAY run, so we need every
      // existing bill id (to remove them all) and the highest occurrence
      // seen (to avoid colliding with it), not just an arbitrary single row.
      const duplicatesByKey = new Map<
        string,
        { existingBillIds: string[]; maxOccurrence: number; anyPaid: boolean }
      >();
      for (const d of duplicates) {
        const key = `${d.student_id}:${d.fee_structure_id}`;
        const group = duplicatesByKey.get(key) ?? {
          existingBillIds: [],
          maxOccurrence: 0,
          anyPaid: false,
        };
        group.existingBillIds.push(d.existing_bill_id);
        group.maxOccurrence = Math.max(group.maxOccurrence, d.occurrence);
        group.anyPaid = group.anyPaid || d.paid_amount > 0;
        duplicatesByKey.set(key, group);
      }

      const dueDate = dto.due_date ? new Date(dto.due_date) : addDays(context.periodStart, 9);

      // Pairs that need an inserted bill, and which existing bill (if any)
      // they replace/stack on.
      const pairsToInsert: { student: Student; structure: FeeStructure; occurrence: number }[] = [];
      const bulkExistingIds: string[] = [];
      let approvalNeeded = false;
      // Every distinct reason seen across the request — a single generate
      // call can mix REMOVE_OLDER-over-a-paid-bill and CREATE_ANYWAY pairs,
      // and the audit trail must reflect all of them, not just the last one.
      const approvalReasons = new Set<'REMOVE_OLDER_PAID' | 'CREATE_ANYWAY'>();

      for (const student of targetStudents) {
        for (const structure of context.structures) {
          const key = `${student.id}:${structure.id}`;
          const existing = duplicatesByKey.get(key);
          if (!existing) {
            pairsToInsert.push({ student, structure, occurrence: 1 });
            continue;
          }

          if (duplicateStrategy === DuplicateStrategy.SKIP) {
            skippedCount += 1;
            continue;
          }

          if (duplicateStrategy === DuplicateStrategy.REMOVE_OLDER) {
            if (existing.anyPaid) {
              approvalNeeded = true;
              approvalReasons.add('REMOVE_OLDER_PAID');
            }
            bulkExistingIds.push(...existing.existingBillIds);
            pairsToInsert.push({ student, structure, occurrence: 1 });
            continue;
          }

          // CREATE_ANYWAY always needs approval — it stacks a new bill on
          // top of one that already exists.
          approvalNeeded = true;
          approvalReasons.add('CREATE_ANYWAY');
          pairsToInsert.push({
            student,
            structure,
            occurrence: existing.maxOccurrence + 1,
          });
        }
      }

      // All-or-nothing: consumed once for the whole request, before any
      // write, so a missing/invalid token rolls back everything.
      let approvedBy: string | null = null;
      if (approvalNeeded) {
        const approval = await this.approvalService.consume(request, DUPLICATE_OVERRIDE_SCOPE);
        approvedBy = approval.approverId;
      }

      const batch = await this.feeGenerationsService.create(
        {
          tenant_id: tenantId,
          academic_year_id: dto.academic_year_id,
          period_start: context.periodStart,
          period_type: dto.period_type,
          due_date: dueDate,
          source: FeeGenerationSource.MANUAL,
          generated_by_user_id: userId,
          approved_by_user_id: approvedBy,
          duplicate_strategy: duplicateStrategy,
          notify_families: notifyFamilies,
          structures: context.structures.map((s) => ({
            id: s.id,
            name: s.name,
            fee_type: s.fee_type,
            amount: Number(s.amount),
          })),
          student_count: targetStudents.length,
          generated_count: 0,
          skipped_count: 0,
          removed_count: 0,
        },
        manager,
      );
      feeGenerationId = batch.id;

      if (bulkExistingIds.length > 0) {
        // Soft-delete (#651's `deleted_at` column) rather than hard-delete:
        // a bill with a payment allocation or invoice pointing at it can't
        // be hard-deleted without an FK violation, and paid bills are
        // already approval-gated above via the REMOVE_OLDER_PAID reason.
        // The unique index on (student_id, fee_structure_id, period_start,
        // occurrence) is partial (`WHERE deleted_at IS NULL`), so a
        // soft-deleted row doesn't block a same-key row being reinserted.
        //
        // Conditional on `deleted_at IS NULL` and checked against the planned
        // count: two concurrent REMOVE_OLDER requests can both read the same
        // live bill in `findDuplicates` above, but only one of them can be
        // the one that actually removes it. The loser would otherwise commit
        // `removed_count = 1` for a bill it never touched, alongside a
        // `generated_count = 0` (its replacement insert is swallowed by
        // `.orIgnore()` below). Failing here rolls the whole batch back.
        const removal = await manager
          .getRepository(StudentFee)
          .createQueryBuilder()
          .softDelete()
          .where('id IN (:...ids)', { ids: bulkExistingIds })
          .andWhere('deleted_at IS NULL')
          .execute();
        if (removal.affected !== bulkExistingIds.length) {
          throw new ConflictException(
            'One or more existing bills were changed by a concurrent request; retry the generation',
          );
        }
        removedCount = bulkExistingIds.length;
      }

      const studentFeeRepo = manager.getRepository(StudentFee);
      const rowsToInsert: Partial<StudentFee>[] = [];
      for (const pair of pairsToInsert) {
        const baseAmount = Number(pair.structure.amount);
        const discount = await this.discountResolver.resolve({
          tenantId,
          studentId: pair.student.id,
          feeStructureId: pair.structure.id,
          baseAmount,
        });
        rowsToInsert.push({
          student_id: pair.student.id,
          academic_year_id: dto.academic_year_id,
          fee_structure_id: pair.structure.id,
          fee_generation_id: feeGenerationId,
          period_start: context.periodStart,
          period_type: dto.period_type,
          occurrence: pair.occurrence,
          total_amount: baseAmount,
          standing_discount_amount: discount.amount,
          one_off_discount_amount: 0,
          discount_amount: discount.amount,
          status: FeeStatus.PENDING,
          due_date: dueDate,
        });
      }

      // Bulk insert with ON CONFLICT DO NOTHING (`.orIgnore()`) rather than
      // per-row save(): a per-row save races a concurrent identical request
      // against the unique (student_id, fee_structure_id, period_start,
      // occurrence) constraint and 500s instead of silently skipping —
      // this is what D6's "SKIP -> ON CONFLICT DO NOTHING" actually asks
      // for, and it also protects CREATE_ANYWAY's occurrence+1 against the
      // same race. We re-query afterwards for the rows that actually landed
      // (orIgnore's returned identifiers are unreliable across drivers for
      // skipped rows), which also gives us real counts under a race.
      // Chunked into batches of 500: at the DTO's legal max (5000 students
      // x 20 fee structures), one unchunked statement can exceed Postgres'
      // 65,535 bound-parameter limit.
      const INSERT_CHUNK_SIZE = 500;
      for (let i = 0; i < rowsToInsert.length; i += INSERT_CHUNK_SIZE) {
        const chunk = rowsToInsert.slice(i, i + INSERT_CHUNK_SIZE);
        await studentFeeRepo
          .createQueryBuilder()
          .insert()
          .into(StudentFee)
          .values(chunk)
          .orIgnore()
          .execute();
      }
      const createdBills = await studentFeeRepo.find({
        where: { fee_generation_id: feeGenerationId },
      });
      generatedCount = createdBills.length;
      // Under SKIP, any row we intended to insert but that lost a
      // concurrent race counts as skipped too, not silently dropped.
      if (duplicateStrategy === DuplicateStrategy.SKIP) {
        skippedCount += rowsToInsert.length - createdBills.length;
      }

      if (approvalNeeded && approvedBy) {
        await this.auditService.recordApproved(
          {
            action: AuditAction.UPDATE,
            entity_type: 'FeeGeneration',
            entity_id: feeGenerationId,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            approved_by_user_id: approvedBy,
            approval_scope: DUPLICATE_OVERRIDE_SCOPE,
            new_values: {
              reasons: [...approvalReasons],
              removed_bill_ids: bulkExistingIds,
              duplicate_strategy: duplicateStrategy,
            },
          },
          manager,
        );
      }

      // Wallet auto-apply: oldest bill first (creation order === insertion
      // order above, which follows the student/structure iteration — good
      // enough as "oldest first" since every bill just got the same
      // due_date/period).
      const billsByStudent = new Map<string, StudentFee[]>();
      for (const bill of createdBills) {
        const list = billsByStudent.get(bill.student_id) ?? [];
        list.push(bill);
        billsByStudent.set(bill.student_id, list);
      }
      for (const [studentId, bills] of billsByStudent) {
        // Read the wallet balance through the same transaction manager (not
        // WalletService.balance(), which queries outside it) so it reflects
        // this transaction's own writes and can't drift from a concurrent
        // debit landing mid-loop.
        const wallet = await manager
          .getRepository(StudentWallet)
          .findOne({ where: { student_id: studentId, tenant_id: tenantId } });
        let balance = wallet ? Number(wallet.balance) : 0;
        if (balance <= 0) continue;
        for (const bill of bills) {
          if (balance <= 0) break;
          const remaining = Number(bill.total_amount) - Number(bill.discount_amount);
          const toApply = Math.min(balance, remaining);
          if (toApply <= 0) continue;
          await this.walletService.debit(
            {
              studentId,
              tenantId,
              amount: toApply,
              kind: WalletTransactionKind.DEBIT_GENERATION,
              studentFeeId: bill.id,
              createdByUserId: userId,
            },
            manager,
          );
          const newPaid = toApply;
          const newStatus =
            newPaid + Number(bill.discount_amount) >= Number(bill.total_amount)
              ? FeeStatus.PAID
              : FeeStatus.PARTIALLY_PAID;
          await studentFeeRepo.update({ id: bill.id }, { paid_amount: newPaid, status: newStatus });
          balance -= toApply;
        }
      }

      await manager.getRepository(FeeGeneration).update(
        { id: feeGenerationId },
        {
          generated_count: generatedCount,
          skipped_count: skippedCount,
          removed_count: removedCount,
        },
      );

      await this.auditService.record(
        {
          action: AuditAction.CREATE,
          entity_type: 'FeeGeneration',
          entity_id: feeGenerationId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          new_values: {
            student_count: targetStudents.length,
            generated_count: generatedCount,
            skipped_count: skippedCount,
            removed_count: removedCount,
          },
        },
        manager,
      );
    });

    // Fires only after the transaction above has committed — everything
    // that could fail and roll the batch back already has, by this point.
    if (notifyFamilies) {
      feesEvents.emit(FEES_GENERATED_EVENT, {
        tenantId,
        feeGenerationId,
      } satisfies FeesGeneratedEventPayload);
    }

    return {
      fee_generation_id: feeGenerationId,
      student_count: studentCount,
      generated_count: generatedCount,
      skipped_count: skippedCount,
      removed_count: removedCount,
      inactive_skipped: inactiveSkipped,
    };
  }

  private async resolveNotifyFamilies(dto: GenerateFeesDto, tenantId: string): Promise<boolean> {
    if (dto.notify_families !== undefined) return dto.notify_families;
    const school = await this.schoolRepo.findOne({ where: { id: tenantId } });
    const settings = resolveTenantSettings(
      (school?.settings as Record<string, unknown> | null) ?? null,
    );
    return settings.fees?.notifyOnManualGenerationDefault ?? false;
  }

  /** Shared validation for both `preview` and `generate`: academic year
   * ownership, period alignment/range, every fee structure and student
   * belongs to this tenant. Throws (and, inside a transaction, rolls back)
   * on the first problem — never a partial write. */
  private async loadContext(
    dto: GenerateFeesPreviewDto,
    tenantId: string,
    manager: EntityManager,
  ): Promise<LoadedContext> {
    const academicYear = await manager.getRepository(AcademicYear).findOne({
      where: { id: dto.academic_year_id, tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (!academicYear) {
      throw new NotFoundException(`Academic year with ID "${dto.academic_year_id}" not found`);
    }

    const { periodStart, periodEnd } = this.assertPeriodWithinAcademicYear(dto, academicYear);

    const structures = await manager.getRepository(FeeStructure).find({
      where: {
        id: In(dto.fee_structure_ids),
        tenant_id: tenantId,
        academic_year_id: dto.academic_year_id,
        deleted_at: IsNull(),
      },
    });
    if (structures.length !== new Set(dto.fee_structure_ids).size) {
      const foundIds = new Set(structures.map((s) => s.id));
      const missing = dto.fee_structure_ids.filter((id) => !foundIds.has(id));
      throw new NotFoundException(
        `Fee structure(s) not found for this tenant/academic year: ${missing.join(', ')}`,
      );
    }

    const students = await manager.getRepository(Student).find({
      where: { id: In(dto.student_ids), tenant_id: tenantId, deleted_at: IsNull() },
    });
    if (students.length !== new Set(dto.student_ids).size) {
      const foundIds = new Set(students.map((s) => s.id));
      const missing = dto.student_ids.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Student(s) not found for this tenant: ${missing.join(', ')}`);
    }

    const activeStudents = students.filter((s) => s.enrollment_status === EnrollmentStatus.ACTIVE);
    const inactiveStudents = students.filter(
      (s) => s.enrollment_status !== EnrollmentStatus.ACTIVE,
    );

    return { academicYear, structures, activeStudents, inactiveStudents, periodStart, periodEnd };
  }

  /** Existing bills for the given students/structures/period — what
   * "duplicate" means for this generation request. `occurrence` is carried
   * for `generate()`'s internal CREATE_ANYWAY bookkeeping but stripped
   * before `preview()` hands this back to the caller (see `preview()`). */
  private async findDuplicates(
    studentIds: string[],
    feeStructureIds: string[],
    periodStart: Date,
    manager: EntityManager,
  ): Promise<(DuplicateBillDto & { occurrence: number })[]> {
    if (studentIds.length === 0 || feeStructureIds.length === 0) return [];
    const existing = await manager.getRepository(StudentFee).find({
      where: {
        student_id: In(studentIds),
        fee_structure_id: In(feeStructureIds),
        period_start: periodStart,
      },
    });
    return existing.map((bill) => ({
      student_id: bill.student_id,
      fee_structure_id: bill.fee_structure_id,
      existing_bill_id: bill.id,
      paid_amount: Number(bill.paid_amount),
      occurrence: bill.occurrence,
    }));
  }

  /**
   * Validates `period_start` is normalised for `period_type` (the 1st of a
   * month for MONTH, a Monday for WEEK) and inside the academic year's
   * date range. Adapted from the pre-16.3.1 `assertMonthWithinAcademicYear`,
   * which only handled a month/year pair.
   */
  private assertPeriodWithinAcademicYear(
    dto: GenerateFeesPreviewDto,
    academicYear: AcademicYear,
  ): { periodStart: Date; periodEnd: Date } {
    const periodStart = new Date(`${dto.period_start}T00:00:00.000Z`);
    if (Number.isNaN(periodStart.getTime())) {
      throw new BadRequestException(`Invalid period_start "${dto.period_start}"`);
    }

    if (dto.period_type === PeriodType.MONTH) {
      if (periodStart.getUTCDate() !== 1) {
        throw new BadRequestException(
          `period_start "${dto.period_start}" must be the 1st of a month for period_type MONTH`,
        );
      }
    } else {
      // getUTCDay(): 0=Sunday..6=Saturday, Monday === 1.
      if (periodStart.getUTCDay() !== 1) {
        throw new BadRequestException(
          `period_start "${dto.period_start}" must be a Monday for period_type WEEK`,
        );
      }
    }

    const periodEnd =
      dto.period_type === PeriodType.MONTH
        ? new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 0))
        : addDays(periodStart, 6);

    const start = new Date(academicYear.start_date);
    const end = new Date(academicYear.end_date);
    if (periodStart < start || periodStart > end) {
      throw new BadRequestException(
        `period_start "${dto.period_start}" is outside academic year "${academicYear.name}" ` +
          `(${academicYear.start_date} to ${academicYear.end_date})`,
      );
    }

    return { periodStart, periodEnd };
  }
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function toInactiveDto(student: Student): InactiveStudentDto {
  return { id: student.id, full_name: student.full_name };
}
