import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ApprovalScope, AuditAction, CouponDiscountKind, CouponScope } from '@biddaloy/shared';
import { AuditService } from '../audit/audit.service';
import type { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

const BAD_CURSOR = 'Invalid cursor';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Postgres timestamptz text; kept as text because a JS Date loses microseconds.
const TS_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

const take = (limit?: number) => Math.min(Math.max(limit ?? 25, 1), 100);
const enc = (...parts: string[]) => Buffer.from(JSON.stringify(parts)).toString('base64url');

function dec(cursor: string | undefined, shape: Array<(s: string) => boolean>): string[] | null {
  if (!cursor) return null;
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(v) &&
      v.length === shape.length &&
      v.every((x, i) => typeof x === 'string' && shape[i](x))
    ) {
      return v as string[];
    }
  } catch {
    /* fall through */
  }
  throw new BadRequestException(BAD_CURSOR);
}

export interface CouponItem {
  id: string;
  code: string;
  discount_kind: CouponDiscountKind;
  percent: number | null;
  fixed_paisa: number | null;
  max_months: number | null;
  max_discount_paisa: string | null;
  min_order_paisa: string | null;
  scope: CouponScope;
  max_uses: number | null;
  uses_count: number;
  per_school_max: number;
  starts_at: Date;
  ends_at: Date;
  active: boolean;
  created_at: Date;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CouponUsage {
  uses: number;
  totalDiscountPaisa: string;
  schools: Page<{ schoolId: string; schoolName: string; uses: number; discountPaisa: string }>;
}

export interface Actor {
  userId: string;
  ip: string | null;
  userAgent: string | null;
}

const COLS = `id, code, discount_kind, percent, fixed_paisa, max_months, max_discount_paisa,
  min_order_paisa, scope, max_uses, uses_count, per_school_max, starts_at, ends_at, active, created_at`;

const taken = () =>
  new ConflictException({
    message: 'That coupon code is already taken.',
    details: { code: 'COUPON_CODE_TAKEN' },
  });
const notFound = () => new NotFoundException('Coupon not found');
const bad = (message: string, code: string) =>
  new BadRequestException({ message, details: { code } });

/**
 * [Epic 100] Owner-side coupon CRUD and the usage report. Platform-owned tables, so nothing here
 * is tenant-scoped. The redeem engine lives in `CouponRedemptionService`.
 */
@Injectable()
export class CouponsService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly audit: AuditService,
  ) {}

  /**
   * `free` is set only by the `/free` route (percent 100). A replay of the same body on a taken
   * code returns the first coupon; a different body is 409 COUPON_CODE_TAKEN.
   */
  async create(dto: CreateCouponDto, opts: { free: boolean }, actor: Actor): Promise<CouponItem> {
    const v = this.validateCreate(dto, opts.free);
    const schools = [...new Set((dto.schools ?? []).map((x) => x.toLowerCase()))].sort();
    return this.db.transaction(async (m) => {
      if (v.scope === CouponScope.SCHOOLS) await this.assertSchoolsExist(m, schools);
      const rows: CouponItem[] = await m.query(
        `INSERT INTO coupons (code, discount_kind, percent, fixed_paisa, max_months,
            max_discount_paisa, min_order_paisa, scope, max_uses, per_school_max, starts_at, ends_at,
            created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (code) DO NOTHING
         RETURNING ${COLS}`,
        [
          dto.code,
          v.kind,
          v.percent,
          v.fixed,
          dto.max_months ?? null,
          dto.max_discount_paisa ?? null,
          dto.min_order_paisa ?? null,
          v.scope,
          dto.max_uses ?? null,
          dto.per_school_max ?? 1,
          dto.starts_at,
          dto.ends_at,
          actor.userId,
        ],
      );
      if (rows.length === 0) return this.replayOrConflict(m, dto, v, schools);
      const coupon = rows[0];
      for (const s of schools) {
        await m.query(`INSERT INTO coupon_schools (coupon_id, school_id) VALUES ($1, $2)`, [
          coupon.id,
          s,
        ]);
      }
      await this.audit.recordApproved(
        {
          action: AuditAction.COUPON_CREATED,
          entity_type: 'Coupon',
          entity_id: coupon.id,
          tenant_id: null,
          performed_by_user_id: actor.userId,
          ip_address: actor.ip,
          user_agent: actor.userAgent,
          new_values: { code: coupon.code, kind: v.kind, percent: v.percent, scope: v.scope },
          approved_by_user_id: actor.userId,
          approval_scope: opts.free
            ? ApprovalScope.PLATFORM_COUPON_FREE
            : ApprovalScope.PLATFORM_COUPON,
        },
        m,
      );
      return coupon;
    });
  }

  /** True when the STORED coupon is a 100 percent one; never read from a request body. */
  async isFree(id: string): Promise<boolean> {
    const [row]: { percent: number | null }[] = await this.db.query(
      `SELECT percent FROM coupons WHERE id = $1`,
      [id],
    );
    if (!row) throw notFound();
    return row.percent === 100;
  }

  async update(id: string, dto: UpdateCouponDto, actor: Actor): Promise<CouponItem> {
    return this.db.transaction(async (m) => {
      const [cur]: CouponItem[] = await m.query(
        `SELECT ${COLS} FROM coupons WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (!cur) throw notFound();
      // The DB CHECK says the same; this answers 400 instead of leaking the constraint text (Rule 24).
      if (dto.max_uses !== undefined && dto.max_uses < cur.uses_count) {
        throw bad('Max uses cannot be below the uses so far.', 'COUPON_MAX_USES_BELOW_USED');
      }
      const endsAt = dto.ends_at ?? cur.ends_at.toISOString();
      if (new Date(endsAt) <= new Date(cur.starts_at)) {
        throw bad('The end must be after the start.', 'COUPON_WINDOW_INVALID');
      }
      if (dto.schools !== undefined) {
        if (cur.scope !== CouponScope.SCHOOLS) {
          throw bad('Only a coupon for chosen schools has a school list.', 'COUPON_SCOPE_INVALID');
        }
        if (dto.schools.length === 0) {
          throw bad('Choose at least one school.', 'COUPON_SCOPE_INVALID');
        }
        const list = [...new Set(dto.schools)];
        await this.assertSchoolsExist(m, list);
        await m.query(`DELETE FROM coupon_schools WHERE coupon_id = $1`, [id]);
        for (const s of list) {
          await m.query(`INSERT INTO coupon_schools (coupon_id, school_id) VALUES ($1, $2)`, [
            id,
            s,
          ]);
        }
      }
      // TypeORM answers an UPDATE ... RETURNING as [rows, affectedCount].
      const [[next]]: [CouponItem[], number] = await m.query(
        `UPDATE coupons SET active = COALESCE($2, active), ends_at = $3, max_uses = COALESCE($4, max_uses)
          WHERE id = $1 RETURNING ${COLS}`,
        [id, dto.active ?? null, endsAt, dto.max_uses ?? null],
      );
      await this.audit.recordApproved(
        {
          action: dto.active === false ? AuditAction.COUPON_DISABLED : AuditAction.COUPON_UPDATED,
          entity_type: 'Coupon',
          entity_id: id,
          tenant_id: null,
          performed_by_user_id: actor.userId,
          ip_address: actor.ip,
          user_agent: actor.userAgent,
          old_values: { active: cur.active, ends_at: cur.ends_at, max_uses: cur.max_uses },
          new_values: {
            active: next.active,
            ends_at: next.ends_at,
            max_uses: next.max_uses,
            schools: dto.schools?.length,
          },
          approved_by_user_id: actor.userId,
          approval_scope: ApprovalScope.PLATFORM_COUPON,
        },
        m,
      );
      return next;
    });
  }

  async list(q: { cursor?: string; limit?: number }): Promise<Page<CouponItem>> {
    const n = take(q.limit);
    const c = dec(q.cursor, [(s) => TS_RE.test(s), (s) => UUID_RE.test(s)]);
    const rows: (CouponItem & { ts: string })[] = await this.db.query(
      `SELECT ${COLS}, created_at::text AS ts FROM coupons
        WHERE ($1::timestamptz IS NULL OR (created_at, id) < ($1::timestamptz, $2::uuid))
        ORDER BY created_at DESC, id DESC LIMIT $3`,
      [c?.[0] ?? null, c?.[1] ?? null, n + 1],
    );
    const more = rows.length > n;
    const items = rows.slice(0, n);
    const last = items[items.length - 1];
    return {
      items: items.map(({ ts: _ts, ...rest }) => rest as CouponItem),
      nextCursor: more && last ? enc(last.ts, last.id) : null,
    };
  }

  async usage(id: string, q: { cursor?: string; limit?: number }): Promise<CouponUsage> {
    const n = take(q.limit);
    const c = dec(q.cursor, [(s) => UUID_RE.test(s)]);
    const [coupon]: { uses_count: number }[] = await this.db.query(
      `SELECT uses_count FROM coupons WHERE id = $1`,
      [id],
    );
    if (!coupon) throw notFound();
    const [{ total }]: { total: string }[] = await this.db.query(
      `SELECT COALESCE(sum(discount_paisa), 0)::text AS total FROM coupon_redemptions WHERE coupon_id = $1`,
      [id],
    );
    const rows: { school_id: string; name: string; uses: string; discount: string }[] =
      await this.db.query(
        `SELECT r.school_id, s.name, count(*)::text AS uses, sum(r.discount_paisa)::text AS discount
           FROM coupon_redemptions r JOIN schools s ON s.id = r.school_id
          WHERE r.coupon_id = $1 AND ($2::uuid IS NULL OR r.school_id > $2::uuid)
          GROUP BY r.school_id, s.name ORDER BY r.school_id LIMIT $3`,
        [id, c?.[0] ?? null, n + 1],
      );
    const items = rows.slice(0, n).map((r) => ({
      schoolId: r.school_id,
      schoolName: r.name,
      uses: Number(r.uses),
      discountPaisa: r.discount,
    }));
    const last = items[items.length - 1];
    return {
      uses: coupon.uses_count,
      totalDiscountPaisa: total,
      schools: { items, nextCursor: rows.length > n && last ? enc(last.schoolId) : null },
    };
  }

  private validateCreate(dto: CreateCouponDto, free: boolean) {
    const kind = free ? CouponDiscountKind.PERCENT : dto.discount_kind;
    const percent = free ? 100 : (dto.percent ?? null);
    const fixed = free ? null : (dto.fixed_paisa ?? null);
    const scope = dto.scope ?? CouponScope.ALL;
    if (kind === CouponDiscountKind.PERCENT && (percent === null || fixed !== null)) {
      throw bad('A percent coupon needs a percent and no fixed amount.', 'COUPON_VALUE_INVALID');
    }
    if (kind === CouponDiscountKind.FIXED && (fixed === null || percent !== null)) {
      throw bad('A fixed coupon needs a fixed amount and no percent.', 'COUPON_VALUE_INVALID');
    }
    // A 100 percent coupon is free: only the /free route (second owner) may make one.
    if (!free && percent === 100) {
      throw bad('A 100 percent coupon is made on the free coupon route.', 'COUPON_FREE_ROUTE_ONLY');
    }
    if (new Date(dto.ends_at) <= new Date(dto.starts_at)) {
      throw bad('The end must be after the start.', 'COUPON_WINDOW_INVALID');
    }
    const n = dto.schools?.length ?? 0;
    if ((scope === CouponScope.SCHOOLS) !== n > 0) {
      throw bad(
        'Choose schools exactly when the coupon is for chosen schools.',
        'COUPON_SCOPE_INVALID',
      );
    }
    return { kind, percent, fixed, scope };
  }

  private async assertSchoolsExist(m: EntityManager, ids: string[]): Promise<void> {
    const [{ n }]: { n: string }[] = await m.query(
      `SELECT count(*) AS n FROM schools WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids],
    );
    if (Number(n) !== ids.length) throw bad('Choose existing schools.', 'COUPON_SCOPE_INVALID');
  }

  /** Same code, same body: hand back the first coupon. Anything else: 409. */
  private async replayOrConflict(
    m: EntityManager,
    dto: CreateCouponDto,
    v: {
      kind: CouponDiscountKind;
      percent: number | null;
      fixed: number | null;
      scope: CouponScope;
    },
    schools: string[],
  ): Promise<CouponItem> {
    const [e]: CouponItem[] = await m.query(`SELECT ${COLS} FROM coupons WHERE code = $1`, [
      dto.code,
    ]);
    if (!e) throw taken();
    const have: { school_id: string }[] = await m.query(
      `SELECT school_id FROM coupon_schools WHERE coupon_id = $1 ORDER BY school_id`,
      [e.id],
    );
    const same =
      e.discount_kind === v.kind &&
      e.percent === v.percent &&
      e.fixed_paisa === v.fixed &&
      e.max_months === (dto.max_months ?? null) &&
      (e.max_discount_paisa === null ? null : Number(e.max_discount_paisa)) ===
        (dto.max_discount_paisa ?? null) &&
      (e.min_order_paisa === null ? null : Number(e.min_order_paisa)) ===
        (dto.min_order_paisa ?? null) &&
      e.scope === v.scope &&
      e.max_uses === (dto.max_uses ?? null) &&
      e.per_school_max === (dto.per_school_max ?? 1) &&
      e.starts_at.getTime() === new Date(dto.starts_at).getTime() &&
      e.ends_at.getTime() === new Date(dto.ends_at).getTime() &&
      have.map((h) => h.school_id).join() === schools.join();
    if (!same) throw taken();
    return e;
  }
}
