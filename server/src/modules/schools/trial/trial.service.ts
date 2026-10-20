import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { EntityManager, Repository } from 'typeorm';
import { AuditAction, PlatformPaymentMethod, SchoolStatus } from '@biddaloy/shared';
import { School } from '../entities/school.entity';
import { BILLING_SUSPENSION_REASONS, TenantStatusService } from '../tenant-status.service';
import { attentionEvents } from '../../attention/attention.constants';
import { emitRecheck } from '../../attention/engine/attention-events';
import { AuditService } from '../../audit/audit.service';
import { EntitlementService } from '../../billing/entitlement.service';
import { OrdersService } from '../../billing/orders.service';

export interface GrantSeatsInput {
  seats: number;
  months: number;
  reason: string;
}

/** `userId: null` is the system actor. */
export interface TrialActor {
  userId: string | null;
}

/**
 * Account start and platform seat grants. The trial is retired (Epic 49 D3): a new school has no
 * `trial_ends_at`; its seat limit comes from the entitlement (NULL during the free period).
 */
@Injectable()
export class TrialService {
  constructor(
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly entitlement: EntitlementService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly tenantStatus: TenantStatusService,
  ) {}

  /** Starts a new school's account. Runs on the caller's transaction manager. */
  async startAccount(schoolId: string, manager: EntityManager, now = new Date()): Promise<void> {
    await manager.update(School, schoolId, {
      trial_ends_at: null,
      seat_limit: await this.entitlement.limitFor(manager, schoolId, now),
    });
  }

  /**
   * Platform grant: a PAID order with method GRANT (unit price 0), created and paid in one
   * transaction, so the recompute, the audit row and the seat limit move together.
   * Unknown school is a 404. A school suspended for a billing reason is reactivated.
   * ponytail: no "below current usage" floor (old extend had one): a grant only adds seats and
   * the entitlement is the sum of orders, so it cannot lower the limit; usage above the limit
   * is blocked at the next student add (SEAT_LIMIT_REACHED), not here.
   */
  async grantSeats(schoolId: string, input: GrantSeatsInput, actor: TrialActor): Promise<School> {
    if (!(await this.schools.exists({ where: { id: schoolId } }))) {
      throw new NotFoundException('School not found');
    }
    await this.orders.createPaid(
      {
        schoolId,
        seats: input.seats,
        months: input.months,
        idempotency_key: `grant:${randomUUID()}`,
        userId: actor.userId,
        unit_price_paisa: 0,
      },
      {
        method: PlatformPaymentMethod.GRANT,
        amount_paisa: '0',
        recordedByUserId: actor.userId,
        onApplied: async (m) => {
          const [school] = await m.query(
            'SELECT status, status_reason FROM schools WHERE id = $1 FOR NO KEY UPDATE',
            [schoolId],
          );
          const reactivated =
            school?.status === SchoolStatus.SUSPENDED &&
            BILLING_SUSPENSION_REASONS.includes(school.status_reason);
          if (reactivated) {
            await m.query(
              `UPDATE schools SET status = 'ACTIVE', status_reason = NULL, status_changed_at = now() WHERE id = $1`,
              [schoolId],
            );
          }
          await this.audit.record(
            {
              action: AuditAction.UPDATE,
              entity_type: 'School',
              entity_id: schoolId,
              tenant_id: schoolId,
              performed_by_user_id: actor.userId,
              new_values: {
                event: 'SEATS_GRANTED',
                seats: input.seats,
                months: input.months,
                reason: input.reason,
                reactivated,
              },
            },
            m,
          );
        },
      },
    );
    await this.tenantStatus.invalidate(schoolId); // a reactivation changes the cached status
    // The legacy rule re-reads trial_ends_at; kept so a school with an old trial date still resolves.
    emitRecheck(attentionEvents, {
      tenantId: schoolId,
      ruleKey: 'trial.ending',
      actorUserId: actor.userId ?? undefined,
    });
    return this.schools.findOneOrFail({ where: { id: schoolId } });
  }
}
