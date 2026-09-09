import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PushSubscription } from './entities/push-subscription.entity';
import { CreatePushSubscriptionDto } from './dto/push-subscription.dto';

/**
 * Self-service Web Push subscription management. Every method takes both
 * `userId` and `tenantId` explicitly and every query filters on both —
 * there is no automatic tenant/user scoping, per the multi-tenancy rule.
 */
@Injectable()
export class PushSubscriptionsService {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly repo: Repository<PushSubscription>,
  ) {}

  /**
   * Upserts by `endpoint` (globally unique — see the entity docstring). If
   * the endpoint already exists under a different user/tenant (a stale
   * subscription from a previous login on the same device/browser, or
   * even a different tenant on a shared device), this re-owns the row to
   * the current caller rather than throwing a duplicate-key error.
   */
  async subscribe(
    userId: string,
    tenantId: string,
    dto: CreatePushSubscriptionDto,
    userAgent: string | null,
  ): Promise<PushSubscription> {
    const existing = await this.repo.findOne({ where: { endpoint: dto.endpoint } });

    const row = existing ?? this.repo.create({ endpoint: dto.endpoint });
    row.user_id = userId;
    row.tenant_id = tenantId;
    row.p256dh = dto.keys.p256dh;
    row.auth = dto.keys.auth;
    row.user_agent = userAgent;
    row.failure_count = 0;

    return this.repo.save(row);
  }

  /** Only the caller's own subscriptions, scoped by user AND tenant. */
  async list(userId: string, tenantId: string): Promise<PushSubscription[]> {
    return this.repo.find({
      where: { user_id: userId, tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
  }

  /** Own-only delete. 404s (never a silent no-op) if the row isn't the caller's. */
  async remove(id: string, userId: string, tenantId: string): Promise<void> {
    const result = await this.repo.delete({ id, user_id: userId, tenant_id: tenantId });
    if (!result.affected) {
      throw new NotFoundException('Push subscription not found');
    }
  }

  /** Explicit opt-out — deletes every subscription the caller owns in this tenant. */
  async removeAll(userId: string, tenantId: string): Promise<void> {
    await this.repo.delete({ user_id: userId, tenant_id: tenantId });
  }
}
