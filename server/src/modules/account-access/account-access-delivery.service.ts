import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CommunicationMedium, CommunicationStatus, CommunicationTrigger } from '@biddaloy/shared';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { CommunicationProviderRegistryService } from '../communications/providers/communication-provider.registry';
import { SchoolsService } from '../schools/schools.service';
import {
  render,
  redact,
  resolveTemplateLocale,
  TemplateKind,
  TemplateVars,
} from './account-access-templates';
import { User } from '../users/entities/user.entity';

export type DeliveryMedium = typeof CommunicationMedium.SMS | typeof CommunicationMedium.EMAIL;

export interface DeliverInput {
  tenantId: string;
  medium: DeliveryMedium;
  to: string;
  recipientName: string;
  kind: TemplateKind;
  vars: Omit<TemplateVars, 'school' | 'name'>;
}

export interface DeliverResult {
  logId: string;
  status: CommunicationStatus;
}

/**
 * Sends an account-access message (invitation, OTP, password-reset link,
 * email-verify link) and logs it — without ever letting the secret sit in
 * `communication_logs.message_body` (12.1's D4). The real, secret-bearing
 * body is a local variable only: it goes to the provider and nowhere else.
 */
@Injectable()
export class AccountAccessDeliveryService {
  constructor(
    @InjectRepository(CommunicationLog)
    private readonly logRepo: Repository<CommunicationLog>,
    private readonly registry: CommunicationProviderRegistryService,
    private readonly schoolsService: SchoolsService,
  ) {}

  async deliver(input: DeliverInput): Promise<DeliverResult> {
    const settings = await this.schoolsService.getResolvedSettings(input.tenantId);
    const locale = resolveTemplateLocale(settings.region?.locale);
    const school = await this.schoolsService.findById(input.tenantId);

    const vars: TemplateVars = { school: school.name, name: input.recipientName, ...input.vars };
    const real = render(input.kind, input.medium, locale, vars);
    const redacted = redact(input.kind, input.medium, locale, vars);

    const log = await this.logRepo.save(
      this.logRepo.create({
        tenant_id: input.tenantId,
        medium: input.medium,
        recipient_address: input.to,
        recipient_name: input.recipientName,
        message_body: redacted.body,
        subject: redacted.subject ?? null,
        status: CommunicationStatus.QUEUED,
        trigger: CommunicationTrigger.ACCOUNT_ACCESS,
        metadata: { kind: input.kind },
      }),
    );

    const provider = this.registry.resolve(input.medium);
    if (!provider) {
      log.status = CommunicationStatus.FAILED;
      log.metadata = { kind: input.kind, error: `No provider configured for ${input.medium}` };
      await this.logRepo.save(log);
      return { logId: log.id, status: CommunicationStatus.FAILED };
    }

    try {
      const result = await provider.send(
        { to: input.to, body: real.body, subject: real.subject },
        input.tenantId,
      );
      if (result.success) {
        log.status = CommunicationStatus.SENT;
        log.provider_message_id = result.providerMessageId;
        await this.logRepo.save(log);
        return { logId: log.id, status: CommunicationStatus.SENT };
      }
      // Never persist `result.error`/`error.message` verbatim — a provider
      // or gateway can echo the request body (including this message's
      // secret-bearing `real.body`, e.g. an activation link or OTP) back in
      // its error text, which would land in communication_logs.metadata.
      log.status = CommunicationStatus.FAILED;
      log.metadata = { kind: input.kind, error: 'Delivery failed' };
      await this.logRepo.save(log);
      return { logId: log.id, status: CommunicationStatus.FAILED };
    } catch {
      log.status = CommunicationStatus.FAILED;
      log.metadata = { kind: input.kind, error: 'Delivery failed' };
      await this.logRepo.save(log);
      return { logId: log.id, status: CommunicationStatus.FAILED };
    }
  }
}

/** `EMAIL` if the user has one, else `SMS` if they have a phone, else `null` — the caller's job to decide, per D5/the plan. */
export function pickChannel(
  user: Pick<User, 'email' | 'phone'>,
): { medium: DeliveryMedium; to: string } | null {
  if (user.email) return { medium: CommunicationMedium.EMAIL, to: user.email };
  if (user.phone) return { medium: CommunicationMedium.SMS, to: user.phone };
  return null;
}
