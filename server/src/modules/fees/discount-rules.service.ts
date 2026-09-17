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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
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
  }): Promise<{ amount: number }> {
    const structure = await this.feeStructureRepo.findOne({
      where: { id: context.feeStructureId, tenant_id: context.tenantId },
    });
    // A late fee is never discounted — checked before touching any rule.
    if (!structure || structure.fee_type === FeeType.LATE_FEE) {
      return { amount: 0 };
    }

    const rules = await this.discountRuleRepo.find({
      where: { tenant_id: context.tenantId, student_id: context.studentId },
    });

    const today = todayIso();
    let best = 0;
    for (const rule of rules) {
      if (rule.starts_on && rule.starts_on > today) continue;
      if (rule.ends_on && rule.ends_on < today) continue;
      if (rule.fee_types && !rule.fee_types.includes(structure.fee_type)) continue;

      const amount =
        rule.kind === DiscountKind.FLAT
          ? Number(rule.value)
          : round2((Number(rule.value) / 100) * context.baseAmount);
      if (amount > best) best = amount;
    }

    return { amount: round2(best) };
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
    });
    return this.discountRuleRepo.save(rule);
  }

  async update(tenantId: string, id: string, dto: UpdateDiscountRuleDto): Promise<DiscountRule> {
    const rule = await this.discountRuleRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!rule) throw new NotFoundException('Discount rule not found');
    Object.assign(rule, {
      ...(dto.kind !== undefined && { kind: dto.kind }),
      ...(dto.value !== undefined && { value: dto.value }),
      ...(dto.fee_types !== undefined && { fee_types: dto.fee_types }),
      ...(dto.starts_on !== undefined && { starts_on: dto.starts_on }),
      ...(dto.ends_on !== undefined && { ends_on: dto.ends_on }),
      ...(dto.reason !== undefined && { reason: dto.reason }),
    });
    return this.discountRuleRepo.save(rule);
  }

  async remove(tenantId: string, id: string): Promise<void> {
    const rule = await this.discountRuleRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!rule) throw new NotFoundException('Discount rule not found');
    await this.discountRuleRepo.softDelete({ id, tenant_id: tenantId });
  }
}
