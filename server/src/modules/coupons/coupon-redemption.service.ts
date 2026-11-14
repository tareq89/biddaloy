import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  AuditAction,
  COUPON_CODE_PATTERN,
  CouponDiscountKind,
  CouponScope,
} from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import { computeCouponDiscount, type DiscountResult } from './coupon-discount';
import { CouponAttemptLimiter } from './coupon-attempt.limiter';

/** One sentence for every refusal (D23, Rule 23): unknown, expired, used up, wrong school, too small. */
export function couponNotValid(): BadRequestException {
  return new BadRequestException({
    message: 'This coupon code is not valid.',
    details: { code: 'COUPON_NOT_VALID' },
  });
}

export function normaliseCouponCode(raw: string): string | null {
  const code = String(raw ?? '')
    .trim()
    .toUpperCase();
  return COUPON_CODE_PATTERN.test(code) ? code : null;
}

export interface CouponPriceInput {
  schoolId: string;
  code: string;
  seats: number;
  months: number;
  /** LIST unit price per seat per month, whole paisa. */
  unitPaisa: number;
}

export interface CouponPreview extends DiscountResult {
  couponId: string;
}

export interface RedeemInput extends CouponPriceInput {
  /**
   * The order must already be inserted by the caller (#3871) in the same transaction:
   * `coupon_redemptions.seat_order_id` is NOT NULL with an FK to `seat_orders`.
   */
  seatOrderId: string;
  /** What the caller wrote on the order; must equal the engine's own result. */
  discountPaisa: number;
}

interface CouponRow {
  id: string;
  discount_kind: CouponDiscountKind;
  percent: number | null;
  fixed_paisa: number | null;
  max_months: number | null;
  max_discount_paisa: string | null;
  min_order_paisa: string | null;
  scope: CouponScope;
  per_school_max: number;
  active: boolean;
  starts_at: Date;
  ends_at: Date;
  max_uses: number | null;
  uses_count: number;
}

const COUPON_COLUMNS = `id, discount_kind, percent, fixed_paisa, max_months, max_discount_paisa,
  min_order_paisa, scope, per_school_max, active, starts_at, ends_at, max_uses, uses_count`;

/**
 * [Epic 100 D23-D25, D29] Checks, prices and uses up a coupon. Platform-owned tables (no tenant
 * RLS), so every query is keyed by the calling school explicitly.
 *
 * ```mermaid
 * flowchart LR
 *   A[code] --> B[limiter ok?] --> C[per-school lock] --> D[one UPDATE uses_count+1]
 *   D --> E[per-school cap + scope] --> F[insert redemption] --> G[caller commits]
 * ```
 */
@Injectable()
export class CouponRedemptionService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly limiter: CouponAttemptLimiter,
    private readonly audit: AuditService,
  ) {}

  /** Same validation and math as `redeemInTx`, no write. A refusal counts as a wrong try. */
  async preview(input: CouponPriceInput, manager?: EntityManager): Promise<CouponPreview> {
    await this.limiter.assertAllowed(input.schoolId);
    try {
      const code = normaliseCouponCode(input.code);
      if (!code) throw couponNotValid();
      const c = await this.find(manager ?? this.db.manager, code);
      if (!c || !this.usableNow(c)) throw couponNotValid();
      await this.checkSchool(manager ?? this.db.manager, c, input.schoolId);
      return { couponId: c.id, ...this.price(c, input) };
    } catch (e) {
      await this.countIfRefused(input.schoolId, e);
      throw e;
    }
  }

  /**
   * Call inside the transaction that inserts the order. Any refusal throws, so the caller's
   * transaction rolls back and `uses_count` is untouched.
   */
  async redeemInTx(m: EntityManager, input: RedeemInput): Promise<CouponPreview> {
    await this.limiter.assertAllowed(input.schoolId);
    try {
      const code = normaliseCouponCode(input.code);
      if (!code) throw couponNotValid();
      // Same school's redemptions queue here, so the per-school count below cannot be raced.
      await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`coupon:${input.schoolId}`]);
      const c = await this.find(m, code);
      if (!c) throw couponNotValid();
      // The single statement that makes the last use safe: the row lock serialises racers and
      // the WHERE re-checks everything that can change under us.
      // TypeORM answers an UPDATE ... RETURNING as [rows, affectedCount].
      const [taken]: [{ id: string }[], number] = await m.query(
        `UPDATE coupons SET uses_count = uses_count + 1
          WHERE id = $1 AND active AND starts_at <= now() AND ends_at > now()
            AND (max_uses IS NULL OR uses_count < max_uses)
          RETURNING id`,
        [c.id],
      );
      if (taken.length === 0) throw couponNotValid();
      await this.checkSchool(m, c, input.schoolId);
      const priced = this.price(c, input);
      if (priced.discountPaisa !== input.discountPaisa) {
        // The caller wrote a different discount on the order: a bug, never a user error.
        throw new Error('Coupon discount does not match the order');
      }
      await m.query(
        `INSERT INTO coupon_redemptions (coupon_id, school_id, seat_order_id, discount_paisa)
         VALUES ($1, $2, $3, $4)`,
        [c.id, input.schoolId, input.seatOrderId, priced.discountPaisa],
      );
      await this.audit.record(
        {
          action: AuditAction.COUPON_REDEEMED,
          entity_type: 'Coupon',
          entity_id: c.id,
          tenant_id: input.schoolId,
          new_values: { seatOrderId: input.seatOrderId, discountPaisa: priced.discountPaisa },
        },
        m,
      );
      return { couponId: c.id, ...priced };
    } catch (e) {
      await this.countIfRefused(input.schoolId, e);
      throw e;
    }
  }

  private async find(m: EntityManager, code: string): Promise<CouponRow | undefined> {
    const rows: CouponRow[] = await m.query(
      `SELECT ${COUPON_COLUMNS} FROM coupons WHERE code = $1`,
      [code],
    );
    return rows[0];
  }

  private usableNow(c: CouponRow): boolean {
    const now = Date.now();
    return (
      c.active &&
      c.starts_at.getTime() <= now &&
      c.ends_at.getTime() > now &&
      (c.max_uses === null || c.uses_count < c.max_uses)
    );
  }

  /** Per-school cap, then scope. Both refuse with the generic sentence. */
  private async checkSchool(m: EntityManager, c: CouponRow, schoolId: string): Promise<void> {
    const [{ n }]: { n: string }[] = await m.query(
      `SELECT count(*) AS n FROM coupon_redemptions WHERE coupon_id = $1 AND school_id = $2`,
      [c.id, schoolId],
    );
    if (Number(n) >= c.per_school_max) throw couponNotValid();
    if (c.scope === CouponScope.SCHOOLS) {
      const hit = await m.query(
        `SELECT 1 FROM coupon_schools WHERE coupon_id = $1 AND school_id = $2`,
        [c.id, schoolId],
      );
      if (hit.length === 0) throw couponNotValid();
    }
  }

  private price(c: CouponRow, i: CouponPriceInput): DiscountResult {
    const r = computeCouponDiscount(
      {
        kind: c.discount_kind,
        percent: c.percent,
        fixedPaisa: c.fixed_paisa,
        maxMonths: c.max_months,
        maxDiscountPaisa: c.max_discount_paisa === null ? null : Number(c.max_discount_paisa),
        minOrderPaisa: c.min_order_paisa === null ? null : Number(c.min_order_paisa),
      },
      { seats: i.seats, months: i.months, unitPaisa: i.unitPaisa },
    );
    if (!r) throw couponNotValid();
    // Only the free route (PERCENT 100) may price an order at 0; a big FIXED coupon must not bypass it.
    if (r.amountPaisa === 0 && !(c.discount_kind === 'PERCENT' && c.percent === 100))
      throw couponNotValid();
    return r;
  }

  private async countIfRefused(schoolId: string, e: unknown): Promise<void> {
    if (e instanceof BadRequestException) await this.limiter.recordFailure(schoolId);
  }
}
