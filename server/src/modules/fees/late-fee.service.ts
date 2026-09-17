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
        `SELECT sf.id, sf.student_id, sf.academic_year_id, sf.period_start,
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

      const lateFeeStructureId = await this.ensureLateFeeStructure(
        manager,
        tenantId,
        candidates[0].academic_year_id,
      );

      for (const bill of candidates) {
        const outstanding =
          Number(bill.total_amount) - Number(bill.discount_amount) - Number(bill.paid_amount);
        const amount =
          rule.kind === DiscountKind.FLAT
            ? Number(rule.value)
            : round2((Number(rule.value) / 100) * outstanding);
        if (amount <= 0) continue;

        await manager.getRepository(StudentFee).insert({
          student_id: bill.student_id,
          academic_year_id: bill.academic_year_id,
          fee_structure_id: lateFeeStructureId,
          period_start: bill.period_start,
          period_type: PeriodType.MONTH,
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
