import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { PushSubscription } from './entities/push-subscription.entity';
import { CreatePushSubscriptionDto } from './dto/push-subscription.dto';

/**
 * Self-service Web Push subscription management. Every method takes both
 * `userId` and `tenantId` explicitly and every query filters on both —
 * there is no automatic tenant/user scoping, per the multi-tenancy rule.
 * There are two deliberate exceptions that span every tenant:
 * `removeAllForUser` ("log out everywhere") filters on `userId` only, and
 * `subscribe` deletes other users' rows for the same endpoint in all
 * tenants (a device that passed to a different person).
 */
@Injectable()
export class PushSubscriptionsService {
  constructor(
    @InjectRepository(PushSubscription)
    private readonly repo: Repository<PushSubscription>,
  ) {}

  /**
   * Upserts by `(endpoint, tenant_id)` — one row per device per school, so
   * a person on one phone can be subscribed in several schools at once.
   * If the endpoint is held by a *different* user (a device that passed to
   * someone else), that user's rows are deleted in every tenant first so
   * the previous owner's notices stop reaching the device. One transaction
   * so the delete and the upsert land together.
   */
  async subscribe(
    userId: string,
    tenantId: string,
    dto: CreatePushSubscriptionDto,
    userAgent: string | null,
  ): Promise<PushSubscription> {
    return this.repo.manager.transaction(async (manager) => {
      // Serialise concurrent subscribes of one endpoint (cross-user claims
      // would otherwise race on the delete + upsert).
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [dto.endpoint]);
      const repo = manager.getRepository(PushSubscription);
      await repo.delete({ endpoint: dto.endpoint, user_id: Not(userId) });

      // Atomic INSERT ... ON CONFLICT (endpoint, tenant_id) DO UPDATE.
      await manager.upsert(
        PushSubscription,
        {
          endpoint: dto.endpoint,
          tenant_id: tenantId,
          user_id: userId,
          p256dh: dto.keys.p256dh,
          auth: dto.keys.auth,
          user_agent: userAgent,
          failure_count: 0,
        },
        ['endpoint', 'tenant_id'],
      );
      return repo.findOneOrFail({ where: { endpoint: dto.endpoint, tenant_id: tenantId } });
    });
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

  /**
   * [JOBS-12] "Log out everywhere" — deletes every subscription the user
   * owns across ALL tenants (a session spans every membership, so no
   * tenant filter on purpose).
   */
  async removeAllForUser(userId: string): Promise<void> {
    await this.repo.delete({ user_id: userId });
  }
}
