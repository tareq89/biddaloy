import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscription } from './entities/push-subscription.entity';
import { PushConfigService } from './push-config';

export interface PushPayload {
  type: string;
  title: string;
  body: string;
  url: string;
}

export interface PushSendResult {
  accepted: number;
  transient: number;
  pruned: number;
}

/**
 * Fans one logical notification out to every live device (subscription) a
 * user holds in a tenant, and classifies each endpoint's outcome so dead
 * subscriptions get pruned and flaky ones get tracked without being
 * deleted. "Success" for the caller means at least one endpoint accepted
 * — callers that need per-device detail should read the returned counts.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    @InjectRepository(PushSubscription)
    private readonly repo: Repository<PushSubscription>,
    private readonly pushConfig: PushConfigService,
  ) {}

  async sendToUser(
    userId: string,
    tenantId: string,
    payload: PushPayload,
  ): Promise<PushSendResult> {
    this.validatePayload(payload);

    if (!this.pushConfig.isPushEnabled()) {
      this.logger.warn('Web push is disabled; sendToUser is a no-op.');
      return { accepted: 0, transient: 0, pruned: 0 };
    }

    const subscriptions = await this.repo.find({ where: { user_id: userId, tenant_id: tenantId } });

    const result: PushSendResult = { accepted: 0, transient: 0, pruned: 0 };
    const body = JSON.stringify(payload);

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: 3600, timeout: 10_000 },
        );
        // The endpoint already accepted the notification — count it now,
        // before any bookkeeping. A `repo.save` failure below must not
        // reclassify an accepted delivery as undelivered, or a caller like
        // `tryPushFirst` (communications.processor.ts) would wrongly fall
        // back and send a paid duplicate through the preferred channel.
        result.accepted++;
        subscription.last_used_at = new Date();
        await this.repo.save(subscription).catch((err: unknown) => {
          this.logger.warn(
            `sendToUser: failed to stamp last_used_at for subscription ${subscription.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      } catch (error) {
        const statusCode = this.getStatusCode(error);
        if (statusCode === 404 || statusCode === 410) {
          await this.repo.delete({ id: subscription.id }).catch((err: unknown) => {
            this.logger.warn(
              `sendToUser: failed to prune dead subscription ${subscription.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
          result.pruned++;
        } else {
          subscription.failure_count++;
          await this.repo.save(subscription).catch((err: unknown) => {
            this.logger.warn(
              `sendToUser: failed to record failure_count for subscription ${subscription.id}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          });
          result.transient++;
        }
      }
    }

    this.logger.log(
      `sendToUser: accepted=${result.accepted} transient=${result.transient} pruned=${result.pruned}`,
    );

    return result;
  }

  private validatePayload(payload: PushPayload): void {
    const { type, title, body, url } = payload;
    if (
      typeof type !== 'string' ||
      typeof title !== 'string' ||
      typeof body !== 'string' ||
      typeof url !== 'string'
    ) {
      throw new Error('Push payload must contain string type, title, body and url fields.');
    }
    if (!url.startsWith('/') || url.startsWith('//')) {
      throw new Error(`Push payload url must be a same-origin path starting with "/": ${url}`);
    }
  }

  private getStatusCode(error: unknown): number | undefined {
    if (error && typeof error === 'object' && 'statusCode' in error) {
      const statusCode = (error as { statusCode: unknown }).statusCode;
      return typeof statusCode === 'number' ? statusCode : undefined;
    }
    return undefined;
  }
}
