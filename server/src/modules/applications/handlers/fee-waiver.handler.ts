import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ApprovalScope, DiscountKind, FeeType } from '@biddaloy/shared';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import { formatApplicationSerial } from '../application-serial';
import { ApprovalService } from '../../auth/guards/approval.guard';
import { DiscountRulesService } from '../../fees/discount-rules.service';
import type { CreateDiscountRuleDto } from '../../fees/dto/discount-rules.dto';

const invalid = (message: string) =>
  new UnprocessableEntityException({ message, details: { code: 'INVALID_GRANTED' } });

/** Accepts `2026-11-01` or `2026-11-01T00:00:00.000Z`; stores the date part only. */
const dateOnly = (v: unknown): string | null => {
  if (v == null || v === '') return null;
  const d = typeof v === 'string' ? v.slice(0, 10) : '';
  // Round-trip catches impossible days such as 2026-02-30 (would be a raw DB 500).
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
    Number.isNaN(Date.parse(d)) ||
    new Date(d).toISOString().slice(0, 10) !== d
  ) {
    throw invalid('Invalid date');
  }
  return d;
};

/**
 * D39 per field: the approver's granted fields win; an omitted one keeps the requested value.
 * The full term set, so `applications.granted` records what the rule was built from (a
 * `fee_types: null` means all fees). Dates keep only their date part; the handler validates.
 */
export function feeWaiverTerms(
  payload: Record<string, unknown>,
  granted?: object | null,
): Record<string, unknown> {
  const picked = Object.entries(granted ?? {}).filter(([, v]) => v !== undefined);
  const t: Record<string, unknown> = { ...payload, ...Object.fromEntries(picked) };
  const day = (v: unknown) => (typeof v === 'string' ? v.slice(0, 10) : (v ?? null));
  return {
    kind: t.kind,
    value: t.value,
    fee_types: t.fee_types ?? null,
    start_date: day(t.start_date),
    end_date: day(t.end_date),
  };
}

/**
 * [52.3.4] Final approval of FEE_WAIVER spends a fresh step-up token and creates the
 * student's discount rule on the decision's transaction (D39: granted terms win).
 * Runs only on the caller's manager; no own transaction, no locks.
 */
@Injectable()
export class FeeWaiverHandler {
  constructor(
    private readonly approvalService: ApprovalService,
    private readonly discountRulesService: DiscountRulesService,
  ) {}

  async apply(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null> {
    // Missing/spent/foreign token throws ApprovalRequiredException -> decision rolls back.
    // Known: the token is spent before the terms are validated, so a later 422 burns it
    // (the whole decision transaction rolls back; the approver just steps up again).
    const approval = await this.approvalService.consume(
      // Express's `user` is Passport's loosely-typed User; consume() only reads `user.sub`.
      ctx.req as unknown as Parameters<ApprovalService['consume']>[0],
      ApprovalScope.DISCOUNT_RULES_MANAGE,
    );

    const terms = feeWaiverTerms(app.payload, ctx.granted);
    const { kind, value } = terms;
    if (kind !== DiscountKind.PERCENT && kind !== DiscountKind.FLAT) {
      throw invalid('Invalid discount kind');
    }
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0 ||
      Math.round(value * 100) / 100 !== value // at most 2 decimals, as the payload DTO
    ) {
      throw invalid('Invalid discount value');
    }
    if (kind === DiscountKind.PERCENT && value > 100) {
      throw invalid('A percent discount cannot exceed 100');
    }
    const feeTypes = terms.fee_types ?? null;
    if (
      feeTypes !== null &&
      (!Array.isArray(feeTypes) ||
        feeTypes.length === 0 ||
        !feeTypes.every((f) => Object.values(FeeType).includes(f as FeeType)))
    ) {
      throw invalid('Invalid fee types');
    }
    if (!app.subject_student_id) throw invalid('Application has no student');

    const serial = formatApplicationSerial(app.serial_year, app.serial_no);
    const dto: CreateDiscountRuleDto = {
      student_id: app.subject_student_id,
      kind,
      value,
      fee_types: feeTypes as FeeType[] | null,
      starts_on: dateOnly(terms.start_date),
      ends_on: dateOnly(terms.end_date),
      reason: `Application ${serial}: ${String(app.payload.reason ?? '')}`.slice(0, 200),
    };

    const rule = await this.discountRulesService.create(
      ctx.tenantId,
      ctx.actorUserId,
      approval.approverId,
      dto,
      manager,
    );
    return {
      discount_rule_id: rule.id,
      kind: rule.kind,
      value: Number(rule.value),
      fee_types: rule.fee_types,
      starts_on: rule.starts_on,
      ends_on: rule.ends_on,
      approved_by_user_id: approval.approverId,
    };
  }
}
