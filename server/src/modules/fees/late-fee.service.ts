import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { DiscountKind, FeeStatus, FeeType, PeriodType } from '@biddaloy/shared';
import { School } from '../schools/entities/school.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { StudentFee } from './entities/student-fee.entity';

interface LateFeeRule {
  enabled: boolean;
  grace_days: number;
  kind: DiscountKind;
  value: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

interface CandidateBillRow {
  id: string;
  student_id: string;
  academic_year_id: string;
  period_start: string;
  period_type: PeriodType;
  total_amount: string;
  discount_amount: string;
  paid_amount: string;
}

/**
 * [16.7.4] Once-per-bill, own-line-item late fees — read directly off
 * `School.settings.fees.lateFees[feeType]` (the raw stored JSON, not
 * `resolveTenantSettings()`: that helper only overlays keys present in
 * `DEFAULT_FEES_SETTINGS`, so an unrecognized `lateFees` key would be
 * silently dropped — see `tenant-settings-resolver.ts`'s
 * `overlayOnDefaults`). Absent settings, or `enabled: false` for a fee
 * type, means that fee type never gets a late fee.
 *
 * Invoked from `FeesDailyScheduler`'s `@Optional() lateFeeService` seam
 * (`fees-daily.scheduler.ts`, [16.7.2]/#676), once per tenant, after that
 * tenant's due recurring schedules have generated their bills for the day.
 */
@Injectable()
export class LateFeeService {
  private readonly logger = new Logger(LateFeeService.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async applyDue(tenantId: string, today: string): Promise<void> {
    const school = await this.dataSource.getRepository(School).findOne({ where: { id: tenantId } });
    if (!school) return;

    const settings = school.settings as Record<string, unknown> | null;
    const feesSettings = settings?.fees as Record<string, unknown> | undefined;
    const lateFees = feesSettings?.lateFees as Record<string, LateFeeRule> | undefined;
    if (!lateFees) return;

    for (const [feeType, rule] of Object.entries(lateFees)) {
      // A late-fee bill never generates a late fee itself — belt-and-braces
      // even though `settings.fees.lateFees` should never carry this key.
      if (feeType === FeeType.LATE_FEE) continue;
      if (!rule?.enabled) continue;

      try {
        await this.applyForFeeType(tenantId, today, feeType as FeeType, rule);
      } catch (error) {
        this.logger.error(
          `late-fee sweep failed for tenant ${tenantId}, fee type ${feeType}: ${String(error)}`,
        );
      }
    }
  }

  private async applyForFeeType(
    tenantId: string,
    today: string,
    feeType: FeeType,
    rule: LateFeeRule,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const candidates = (await manager.query(
        `SELECT sf.id, sf.student_id, sf.academic_year_id, sf.period_start, sf.period_type,
                sf.total_amount, sf.discount_amount, sf.paid_amount
           FROM student_fees sf
           JOIN fee_structures fs ON fs.id = sf.fee_structure_id
          WHERE sf.deleted_at IS NULL
            AND fs.fee_type = $1
            AND fs.tenant_id = $2
            AND sf.status IN ('PENDING', 'PARTIALLY_PAID')
            AND sf.due_date IS NOT NULL
            AND (sf.due_date + ($3 || ' days')::interval) <= $4::date
            AND NOT EXISTS (
              SELECT 1 FROM student_fees late
               WHERE late.late_fee_for_student_fee_id = sf.id AND late.deleted_at IS NULL
            )
          FOR UPDATE OF sf`,
        [feeType, tenantId, rule.grace_days, today],
      )) as CandidateBillRow[];

      if (candidates.length === 0) return;

      // [Opus review, B1 — non-blocking follow-up] One `LATE_FEE`
      // structure per (tenant, academic year) — derived per bill, not
      // from `candidates[0]`, so a sweep that spans an academic-year
      // boundary (a bill from last year still overdue) doesn't wrongly
      // attach every late fee in the batch to one year's structure.
      const lateFeeStructureIdByYear = new Map<string, string>();

      for (const bill of candidates) {
        const outstanding =
          Number(bill.total_amount) - Number(bill.discount_amount) - Number(bill.paid_amount);
        // [Opus review, non-blocking] round2 on both branches — FLAT was
        // previously inserted unrounded (an operator-entered value like
        // 99.999 would otherwise reach the DB as-is).
        const amount =
          rule.kind === DiscountKind.FLAT
            ? round2(Number(rule.value))
            : round2((Number(rule.value) / 100) * outstanding);
        if (amount <= 0) continue;

        let lateFeeStructureId = lateFeeStructureIdByYear.get(bill.academic_year_id);
        if (!lateFeeStructureId) {
          lateFeeStructureId = await this.ensureLateFeeStructure(
            manager,
            tenantId,
            bill.academic_year_id,
          );
          lateFeeStructureIdByYear.set(bill.academic_year_id, lateFeeStructureId);
        }

        // [Opus review, B1 — blocking] Every late-fee bill in one sweep
        // shares the same `fee_structure_id` (the one placeholder LATE_FEE
        // structure) — two *different* original bills overdue for the
        // same `period_start` (e.g. a TUITION and a TRANSPORT bill both
        // due 2026-01-01) would otherwise both insert `occurrence: 1`
        // (the column default) and collide on
        // `UQ_student_fees_student_structure_period_occurrence`
        // (`student_id`, `fee_structure_id`, `period_start`, `occurrence`)
        // — which rolled back the *entire* fee-type transaction with only
        // a log line, silently losing every late fee in that batch.
        // Computed fresh (not cached) so it also accounts for late-fee
        // rows this same loop has already queued this transaction.
        const [{ next_occurrence: occurrence }] = (await manager.query(
          `SELECT COALESCE(MAX(occurrence), 0) + 1 AS next_occurrence
             FROM student_fees
            WHERE student_id = $1 AND fee_structure_id = $2 AND period_start = $3`,
          [bill.student_id, lateFeeStructureId, bill.period_start],
        )) as { next_occurrence: number }[];

        await manager.getRepository(StudentFee).insert({
          student_id: bill.student_id,
          academic_year_id: bill.academic_year_id,
          fee_structure_id: lateFeeStructureId,
          period_start: bill.period_start,
          // [Opus review, non-blocking] the original bill's own
          // period_type — was hardcoded to MONTH, losing a WEEK original.
          period_type: bill.period_type,
          occurrence,
          total_amount: amount,
          paid_amount: 0,
          discount_amount: 0,
          status: FeeStatus.PENDING,
          due_date: addDays(today, 7),
          late_fee_for_student_fee_id: bill.id,
        } as unknown as Partial<StudentFee>);
      }
    });
  }

  /** One `LATE_FEE` `FeeStructure` per tenant per academic year, created on
   * first use — `amount: 0.01` rather than `0`: `fee_structures` has a
   * `CHK_fs_amount` check constraint requiring a positive amount. The real
   * per-bill amount always lives on the generated `StudentFee` row, never
   * this placeholder structure. */
  private async ensureLateFeeStructure(
    manager: EntityManager,
    tenantId: string,
    academicYearId: string,
  ): Promise<string> {
    const existing = await manager.getRepository(FeeStructure).findOne({
      where: { tenant_id: tenantId, academic_year_id: academicYearId, fee_type: FeeType.LATE_FEE },
    });
    if (existing) return existing.id;

    const created = await manager.getRepository(FeeStructure).save(
      manager.getRepository(FeeStructure).create({
        tenant_id: tenantId,
        academic_year_id: academicYearId,
        fee_type: FeeType.LATE_FEE,
        name: 'Late fee',
        amount: 0.01,
      }),
    );
    return created.id;
  }
}
