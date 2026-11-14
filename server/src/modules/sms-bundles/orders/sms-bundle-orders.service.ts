import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { AuditAction, SmsBundleOrderStatus as S } from '@biddaloy/shared';
import { AuditService } from '../../audit/audit.service';
import { readSmsSource } from '../../communications/sms-source/sms-source.util';
import { SmsAllocationService } from '../stock/sms-allocation.service';
import type { SmsBundleOrderViewDto } from './dto/sms-bundle-orders.dto';

/** D-status machine. #3858, #3860 and #3872 call it before every status change. */
const MOVES: Record<S, readonly S[]> = {
  [S.PENDING_PAYMENT]: [S.PAID, S.CANCELLED],
  [S.PAID]: [S.ACTIVE],
  [S.ACTIVE]: [S.USED_UP, S.EXPIRED, S.REFUNDED],
  [S.USED_UP]: [],
  [S.EXPIRED]: [],
  [S.CANCELLED]: [],
  [S.REFUNDED]: [],
};
export const canMove = (from: S, to: S): boolean => MOVES[from]?.includes(to) ?? false;

export interface CreateOrderInput {
  schoolId: string;
  userId: string | null;
  packageId: string;
  idempotencyKey: string;
  ip?: string | null;
  userAgent?: string | null;
}

interface Row {
  id: string;
  catalog_id: string;
  name_snapshot: string;
  sms_count: number;
  validity_days: number;
  price_paisa: string;
  cost_paisa_per_sms: string | null;
  status: S;
  created_at: Date;
  paid_at: Date | null;
  cancelled_at: Date | null;
}

const COLS = `id, catalog_id, name_snapshot, sms_count, validity_days, price_paisa::text AS price_paisa,
  cost_paisa_per_sms::text AS cost_paisa_per_sms, status, created_at, paid_at, cancelled_at`;

const toDto = (r: Row): SmsBundleOrderViewDto => ({
  id: r.id,
  packageId: r.catalog_id,
  name: r.name_snapshot,
  smsCount: r.sms_count,
  validityDays: r.validity_days,
  pricePaisa: r.price_paisa,
  costPaisaPerSms: r.cost_paisa_per_sms,
  status: r.status,
  createdAt: r.created_at.toISOString(),
  paidAt: r.paid_at ? r.paid_at.toISOString() : null,
  cancelledAt: r.cancelled_at ? r.cancelled_at.toISOString() : null,
});

// Fixed sentences: nothing sent by the client is echoed (Rule 23).
const gone = () => new BadRequestException('This SMS package is not available');
const reused = () =>
  new ConflictException({
    message: 'This idempotency key was already used for a different order',
    details: { code: 'IDEMPOTENCY_KEY_REUSED' },
  });

@Injectable()
export class SmsBundleOrdersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly allocation: SmsAllocationService,
    private readonly audit: AuditService,
  ) {}

  async list(schoolId: string, limit = 20, offset = 0): Promise<SmsBundleOrderViewDto[]> {
    const rows: Row[] = await this.ds.query(
      `SELECT ${COLS} FROM sms_bundle_orders WHERE school_id = $1
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [schoolId, Math.min(Math.max(limit, 1), 100), Math.max(offset, 0)],
    );
    return rows.map(toDto);
  }

  /** Another school's order is the same 404 as an unknown one (Rule 23). */
  async get(schoolId: string, id: string): Promise<SmsBundleOrderViewDto> {
    const [row]: Row[] = await this.ds.query(
      `SELECT ${COLS} FROM sms_bundle_orders WHERE school_id = $1 AND id = $2`,
      [schoolId, id],
    );
    if (!row) throw new NotFoundException('SMS order not found');
    return toDto(row);
  }

  /** Same (school, key) and package returns the first order; a different package is 409. */
  async create(input: CreateOrderInput): Promise<SmsBundleOrderViewDto> {
    // A replay answers from the first order even if the package was switched off since.
    const first = await this.byKey(this.ds.manager, input);
    if (first) return first;

    return this.ds.transaction(async (m) => {
      // FOR SHARE: an owner edit or switch-off waits for this order to be written.
      const [pkg]: Array<{
        id: string;
        name: string;
        sms_count: number;
        validity_days: number;
        price_paisa: string;
        active: boolean;
      }> = await m.query(
        `SELECT id, name, sms_count, validity_days, price_paisa::text AS price_paisa, active
           FROM sms_bundle_catalog WHERE id = $1 FOR SHARE`,
        [input.packageId],
      );
      if (!pkg || !pkg.active) throw gone();

      const [school]: Array<{ settings: Record<string, unknown> | null }> = await m.query(
        `SELECT settings FROM schools WHERE id = $1`,
        [input.schoolId],
      );
      // D9: the school switches to SchoolManagerP first; the screen offers the switch.
      if (!school || readSmsSource(school.settings) !== 'SCHOOLMANAGERP') {
        throw new ConflictException({
          message: 'Switch this school to SchoolManagerP SMS before buying a package',
          details: { code: 'SMS_SOURCE_NOT_PLATFORM' },
        });
      }
      // D8: never sell more than the provider holds.
      if (await this.allocation.isOversold(m)) {
        throw new ConflictException({
          message: 'SMS sales are paused for now',
          details: { code: 'SMS_SALES_PAUSED' },
        });
      }
      const cost = await this.allocation.weightedAverageCostPaisaPerSms();

      const ins: unknown[] = await m.query(
        `INSERT INTO sms_bundle_orders (school_id, catalog_id, name_snapshot, sms_count, validity_days,
                price_paisa, cost_paisa_per_sms, status, idempotency_key, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (school_id, idempotency_key) DO NOTHING RETURNING id`,
        [
          input.schoolId,
          pkg.id,
          pkg.name,
          pkg.sms_count,
          pkg.validity_days,
          pkg.price_paisa,
          cost === null ? null : String(cost),
          S.PENDING_PAYMENT,
          input.idempotencyKey,
          input.userId,
        ],
      );
      const order = (await this.byKey(m, input))!;
      // Audit only the call that really inserted: a lost race returns the winner's row silently.
      if (ins.length > 0) {
        await this.audit.record(
          {
            action: AuditAction.SMS_BUNDLE_ORDERED,
            entity_type: 'SmsBundleOrder',
            entity_id: order.id,
            tenant_id: input.schoolId,
            performed_by_user_id: input.userId,
            ip_address: input.ip ?? null,
            user_agent: input.userAgent ?? null,
            new_values: {
              package_id: order.packageId,
              name: order.name,
              sms_count: order.smsCount,
              price_paisa: order.pricePaisa,
            },
          },
          m,
        );
      }
      return order;
    });
  }

  private async byKey(
    m: EntityManager,
    i: CreateOrderInput,
  ): Promise<SmsBundleOrderViewDto | null> {
    const [row]: Row[] = await m.query(
      `SELECT ${COLS} FROM sms_bundle_orders WHERE school_id = $1 AND idempotency_key = $2`,
      [i.schoolId, i.idempotencyKey],
    );
    if (!row) return null;
    if (row.catalog_id !== i.packageId) throw reused();
    return toDto(row);
  }
}
