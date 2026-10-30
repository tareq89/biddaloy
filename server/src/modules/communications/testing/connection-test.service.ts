import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CommunicationMedium,
  CommunicationStatus,
  CommunicationTrigger,
  countSmsSegments,
} from '@biddaloy/shared';
import {
  ConnectionTestResult,
  TestableCommunicationMedium,
} from '../providers/shared/connection-test.types';
import { isMessageSink } from '../providers/sink/message-sink';
import { CommunicationProviderRegistryService } from '../providers/communication-provider.registry';
import { sendThroughProvider } from '../providers/send-through-provider';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';
import { CommunicationLog } from '../entities/communication-log.entity';
import { School } from '../../schools/entities/school.entity';
import { SmsCreditService } from '../credits/sms-credit.service';
import { INSUFFICIENT_SMS_CREDIT } from '../credits/insufficient-sms-credit.constants';
import { BD_PHONE_REGEX } from '../../students/dto/students.dto';
import { ConnectionTestResultDto } from './connection-test-result.dto';

/** Who gets the test message, and who asked for it (D28). */
export interface TestMessageRequest {
  sendTo: string;
  userId: string;
}

/** Per-tenant cap on real test sends in any rolling 24h (every one costs a message or a credit). */
export const TEST_SENDS_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const NO_TEST_MESSAGE = 'This provider cannot send a test message.';
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * #8.7.12: verifies a medium's credentials against the real provider without sending a message —
 * each provider's own `testConnection()` picks its cheapest verification call.
 *
 * `override` is the unsaved form values (same shape as a `communications.<medium>` block); omitted
 * fields fall through tenant settings then platform env via `MessagingConfigResolver`, the same
 * chain a real send uses.
 *
 * Never lets a raw provider error escape: every path returns `ConnectionTestResult`'s sanitized
 * `message`, including `ProviderNotConfiguredError` thrown before any call is made.
 */
@Injectable()
export class ConnectionTestService {
  private readonly logger = new Logger(ConnectionTestService.name);

  constructor(
    private readonly registry: CommunicationProviderRegistryService,
    @InjectRepository(CommunicationLog) private readonly logs: Repository<CommunicationLog>,
    @InjectRepository(School) private readonly schools: Repository<School>,
    private readonly smsCredits: SmsCreditService,
  ) {}

  async test(
    tenantId: string,
    medium: TestableCommunicationMedium,
    override?: Record<string, unknown>,
    testMessage?: TestMessageRequest,
  ): Promise<ConnectionTestResultDto> {
    // Epic 87 (D24): on a sink stack nothing real is configured; fixed text, no tenant data read.
    if (isMessageSink()) {
      // With `sendTo` the caller expects a message: say plainly none was sent (nothing is logged).
      return {
        success: true,
        message: testMessage
          ? 'Test site: messages go to the test inbox. No real message was sent.'
          : 'Test site: messages go to the test inbox',
      };
    }
    try {
      const { provider, config } = await this.registry.resolveFor(
        medium as CommunicationMedium,
        tenantId,
        // testConnection() sends nothing, so `sendOnly` fields (an email `from`) are not needed.
        { override, connectionTestOnly: true },
      );
      // Refuse before any outbound call: no support or a bad address is the caller's mistake.
      if (testMessage) {
        if (!provider.descriptor.supportsTestMessage)
          throw new BadRequestException(NO_TEST_MESSAGE);
        this.assertAddress(medium, testMessage.sendTo);
        await this.assertDailyCap(tenantId);
      }
      const result = await provider.testConnection(config);
      if (!result.success || !testMessage) return result;
      // Its own catch: a credit/DB failure after a passing connection test is not "Connection test failed."
      let sent: { logId: string; status: CommunicationStatus };
      try {
        sent = await this.sendTestMessage(
          tenantId,
          medium as CommunicationMedium,
          provider,
          config,
          testMessage,
        );
      } catch (err) {
        if (err instanceof HttpException) throw err;
        throw new InternalServerErrorException('The test message could not be sent.');
      }
      return { ...result, testMessage: sent };
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Only ProviderNotConfiguredError carries an actionable, secret-free message. Anything
      // else (a network error that escaped a provider) may echo a key or URL: fixed text (Rules 23/24).
      return {
        success: false,
        message:
          err instanceof ProviderNotConfiguredError ? err.message : 'Connection test failed.',
      };
    }
  }

  /** Rolling-24h cap on real test sends per tenant, counted from the logs the sends themselves wrote. */
  private async assertDailyCap(tenantId: string): Promise<void> {
    const used = await this.logs
      .createQueryBuilder('l')
      .where('l.tenant_id = :tenantId', { tenantId })
      .andWhere(`l.metadata->>'test' = 'true'`)
      .andWhere('l.created_at > :since', { since: new Date(Date.now() - DAY_MS) })
      .getCount();
    if (used >= TEST_SENDS_PER_DAY) {
      throw new HttpException(
        'Too many test messages today. Try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private assertAddress(medium: TestableCommunicationMedium, sendTo: string): void {
    const ok =
      medium === CommunicationMedium.SMS
        ? BD_PHONE_REGEX.test(sendTo)
        : medium === CommunicationMedium.EMAIL && EMAIL_SHAPE.test(sendTo);
    if (!ok) throw new BadRequestException('Enter a valid number or address for this channel.');
  }

  /**
   * Sends straight through the resolved (possibly unsaved) config, not the queue: the queue worker
   * re-reads SAVED settings, and unsaved secrets must never sit in Redis. Writes one terminal log
   * row like any message, and settles credit the way the worker does.
   *
   * ponytail: reserve/log/settle mirrors CommunicationsProcessor.settleSmsCredit and
   * CommunicationsService.enqueue. Not extracted: the worker's copy is tied to a BullMQ job and
   * mutates its own log + Sentry tags, so a shared helper would be a wide change. Fold in if a third
   * caller appears.
   *
   * The UI must mint a fresh Idempotency-Key per click: a reused key replays the stored response
   * (no second send), which is intended for retries but would swallow a deliberate second test.
   * Credit reserved by an AMBIGUOUS send stays reserved; the reconcile script lists it as a
   * BATCH_REMAINDER after 24h (it walks the ledger, not the logs), so a missing log row is still found.
   */
  private async sendTestMessage(
    tenantId: string,
    medium: CommunicationMedium,
    provider: Parameters<typeof sendThroughProvider>[0],
    config: unknown,
    req: TestMessageRequest,
  ) {
    const school = await this.schools.findOne({ where: { id: tenantId }, select: ['id', 'name'] });
    const body = `Biddaloy test message from ${school?.name ?? 'your school'} — সব ঠিক আছে / all good`;
    const subject = medium === CommunicationMedium.EMAIL ? 'Biddaloy test message' : undefined;

    // Metered SMS: reserve first, exactly as CommunicationsService.enqueue does.
    let reservation: { batchId: string; segments: number } | undefined;
    if (medium === CommunicationMedium.SMS) {
      const segments = countSmsSegments(body).segments;
      const batchId = randomUUID();
      const outcome = await this.smsCredits.reserveIfMetered(tenantId, segments, batchId);
      if (typeof outcome === 'object') {
        throw new ConflictException({
          message: 'Insufficient SMS credit to send this message.',
          details: {
            code: INSUFFICIENT_SMS_CREDIT,
            required: segments,
            available: outcome.available,
          },
        });
      }
      if (outcome === 'RESERVED') reservation = { batchId, segments };
    }

    const result = await sendThroughProvider(
      provider,
      { to: req.sendTo, body, subject },
      config as never,
    );
    let log: CommunicationLog;
    try {
      log = await this.logs.save(
        this.logs.create({
          tenant_id: tenantId,
          medium,
          recipient_address: req.sendTo,
          recipient_name: 'Test',
          message_body: body,
          subject: subject ?? null,
          sent_by_user_id: req.userId,
          status: result.success ? CommunicationStatus.SENT : CommunicationStatus.FAILED,
          trigger: CommunicationTrigger.MANUAL,
          provider_message_id: result.success ? result.providerMessageId : null,
          metadata: {
            test: true,
            ...(result.segments !== undefined ? { segments: result.segments } : {}),
            ...(result.success ? {} : { error: result.error }),
          },
        }),
      );
    } catch (err) {
      if (reservation && !(!result.success && result.outcome === 'REJECTED')) {
        // The send may have gone out and there is no log row: alert ops (ids only, no recipient/body).
        this.logger.error({
          msg: 'test sms send left credit reserved and no log row',
          tenant_id: tenantId,
          batch_id: reservation.batchId,
          needs_reconciliation: 'true',
        });
        Sentry.withScope((scope) => {
          scope.setTags({
            tenant_id: tenantId,
            batch_id: reservation.batchId,
            needs_reconciliation: 'true',
          });
          Sentry.captureException(err instanceof Error ? err : new Error(String(err)));
        });
      }
      // No row to settle against: give the reservation back unless the send may have gone out.
      if (reservation && !result.success && result.outcome === 'REJECTED') {
        await this.smsCredits.releaseForLog(
          tenantId,
          reservation.batchId,
          reservation.segments,
          reservation.batchId,
        );
      }
      throw new InternalServerErrorException('The test message could not be recorded.');
    }

    // AMBIGUOUS never settles: the reservation waits for reconciliation, same as the worker.
    if (reservation && (result.success || result.outcome === 'REJECTED')) {
      try {
        await this.smsCredits.settlePart(
          tenantId,
          `batch:${reservation.batchId}`,
          `log:${log.id}`,
          reservation.segments,
          result.success ? 'DEBIT' : 'RELEASE',
        );
        log.metadata = { ...log.metadata, credit: result.success ? 'DEBITED' : 'RELEASED' };
      } catch {
        log.metadata = { ...log.metadata, credit: 'UNSETTLED' };
      }
      await this.logs.save(log).catch(() => undefined); // the debit already happened; metadata is best-effort
    }
    return { logId: log.id, status: log.status };
  }
}
