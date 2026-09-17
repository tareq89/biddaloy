import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiscountKind, FeeType } from '@biddaloy/shared';
import { DiscountRule } from './entities/discount-rule.entity';
import { FeeStructure } from './entities/fee-structure.entity';
import { CreateDiscountRuleDto, UpdateDiscountRuleDto } from './dto/discount-rules.dto';
import { DiscountResolver } from './fee-generation.service';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * [16.7.3] `DiscountRule` CRUD (approval-gated at the controller boundary,
 * `ApprovalScope.DISCOUNT_RULES_MANAGE`) plus the `DiscountResolver` this
 * feeds into `FeeGenerationService` (wired in `fees.module.ts`, replacing
 * `NoopDiscountResolver`).
 *
 * Resolution rules, at generation time for one (student, fee structure):
 * - A `LATE_FEE`-type fee structure never gets a discount — checked before
 *   any rule lookup, regardless of what a rule's `fee_types` says.
 * - A rule with `fee_types: NULL` applies to every other fee type; a rule
 *   with a list only applies when the structure's `fee_type` is in it.
 * - A rule only applies if `starts_on <= today <= ends_on` (nulls = open
 *   ended on that side).
 * - Among the rules that apply, the LARGEST resulting discount amount
 *   wins — not the largest `value` — so a 100tk FLAT can beat a 5% PERCENT
 *   on a small bill and lose to it on a large one. PERCENT is rounded
 *   half-up to 2 decimals.
 */
@Injectable()
export class DiscountRulesService implements DiscountResolver {
  constructor(
    @InjectRepository(DiscountRule)
    private readonly discountRuleRepo: Repository<DiscountRule>,
    @InjectRepository(FeeStructure)
    private readonly feeStructureRepo: Repository<FeeStructure>,
  ) {}

  async resolve(context: {
    tenantId: string;
    studentId: string;
    feeStructureId: string;
    baseAmount: number;
    // [Opus review, B5] the period this bill is *for* ('YYYY-MM-DD') —
    // expiry (starts_on/ends_on) is checked against this, not "today", so
    // a back-dated generation run evaluates the rules that were live for
    // that period, not whatever's live when generation happens to run.
    periodStart: string;
  }): Promise<{ amount: number }> {
    const structure = await this.feeStructureRepo.findOne({
      where: { id: context.feeStructureId, tenant_id: context.tenantId },
    });
    // A late fee is never discounted — checked before touching any rule.
    if (!structure || structure.fee_type === FeeType.LATE_FEE) {
      return { amount: 0 };
    }

    const rules = await this.discountRuleRepo.find({
      // [Opus review, B3] an inactive rule (paused, not deleted) must not
      // resolve — same as an expired one.
      where: { tenant_id: context.tenantId, student_id: context.studentId, is_active: true },
    });

    const period = context.periodStart;
    let best = 0;
    for (const rule of rules) {
      if (rule.starts_on && rule.starts_on > period) continue;
      if (rule.ends_on && rule.ends_on < period) continue;
      if (rule.fee_types && !rule.fee_types.includes(structure.fee_type)) continue;

      const amount =
        rule.kind === DiscountKind.FLAT
          ? Number(rule.value)
          : round2((Number(rule.value) / 100) * context.baseAmount);
      if (amount > best) best = amount;
    }

    // [Opus review, B2] A discount can never exceed the bill it's applied
    // to — a FLAT rule's `value` is operator-entered with no upper bound
    // at write time (unlike PERCENT, capped 0-100 in the DTO), so an
    // oversized FLAT rule must be capped here rather than trusted to
    // never overshoot `baseAmount`.
    return { amount: round2(Math.min(best, context.baseAmount)) };
  }

  async listForStudent(tenantId: string, studentId: string): Promise<DiscountRule[]> {
    return this.discountRuleRepo.find({
      where: { tenant_id: tenantId, student_id: studentId },
      order: { created_at: 'DESC' },
    });
  }

  async create(
    tenantId: string,
    userId: string,
    approverUserId: string,
    dto: CreateDiscountRuleDto,
  ): Promise<DiscountRule> {
    const rule = this.discountRuleRepo.create({
      tenant_id: tenantId,
      student_id: dto.student_id,
      kind: dto.kind,
      value: dto.value,
      fee_types: dto.fee_types ?? null,
      starts_on: dto.starts_on ?? null,
      ends_on: dto.ends_on ?? null,
      reason: dto.reason,
      created_by_user_id: userId,
      approved_by_user_id: approverUserId,
    });
    return this.discountRuleRepo.save(rule);
  }

  async update(
    tenantId: string,
    id: string,
    approverUserId: string,
    dto: UpdateDiscountRuleDto,
  ): Promise<DiscountRule> {
    const rule = await this.discountRuleRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!rule) throw new NotFoundException('Discount rule not found');
    Object.assign(rule, {
      ...(dto.kind !== undefined && { kind: dto.kind }),
      ...(dto.value !== undefined && { value: dto.value }),
      ...(dto.fee_types !== undefined && { fee_types: dto.fee_types }),
      ...(dto.starts_on !== undefined && { starts_on: dto.starts_on }),
      ...(dto.ends_on !== undefined && { ends_on: dto.ends_on }),
      ...(dto.reason !== undefined && { reason: dto.reason }),
      ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      // [Opus review, B3/B4] every write — including a deactivate-only
      // PATCH — is approval-gated, so the approver of record always moves
      // to whoever most recently spent a valid token for this row.
      approved_by_user_id: approverUserId,
    });
    return this.discountRuleRepo.save(rule);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const rule = await this.discountRuleRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!rule) throw new NotFoundException('Discount rule not found');
    await this.discountRuleRepo.softDelete({ id, tenant_id: tenantId });
  }
}
