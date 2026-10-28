import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { CommunicationMedium, countSmsSegments } from '@biddaloy/shared';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { MESSAGE_SINK_PROVIDER } from './message-sink';

const DEFAULT_SMTP_URL = 'smtp://mailpit:1025';

/**
 * Test-inbox provider (Epic 87): with `MESSAGE_SINK=mailpit` every medium is delivered to Mailpit
 * as a tagged email carrying the real body. The registry builds one instance per medium; it is
 * never tenant-configured and the SMTP target is a fixed alias or operator env.
 */
export class MailpitSinkProvider implements CommunicationProvider {
  private readonly logger = new Logger(MailpitSinkProvider.name);

  constructor(private readonly medium: CommunicationMedium) {}

  static forMedium(medium: CommunicationMedium): MailpitSinkProvider {
    return new MailpitSinkProvider(medium);
  }

  async send(params: CommunicationSendParams): Promise<CommunicationSendResult> {
    const isEmail = this.medium === CommunicationMedium.EMAIL;
    const isTemplate = !!params.templateName;
    const subject = isTemplate
      ? `[WhatsApp template ${params.templateName}]`
      : isEmail
        ? (params.subject ?? '')
        : `[${this.medium}] to ${params.to}`;
    const text = isTemplate
      ? [`language: ${params.templateLanguage ?? ''}`, ...(params.templateParams ?? [])].join('\n')
      : params.body;
    try {
      const transport = nodemailer.createTransport(
        process.env.MESSAGE_SINK_SMTP_URL ?? DEFAULT_SMTP_URL,
        { connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 10000 },
      );
      await transport.sendMail({
        from: `${this.medium.toLowerCase()}@sink.invalid`,
        to: isEmail ? params.to : `${params.to}@sms.sink.invalid`,
        subject,
        text,
        headers: { 'X-Tags': this.medium },
      });
    } catch {
      // Never log the body or the full recipient.
      this.logger.warn(`sink send failed (${this.medium}) to ${maskRecipient(params.to)}`);
      return {
        success: false,
        error: 'Test inbox unreachable',
        retryable: false,
        outcome: 'REJECTED',
        providerMessageId: null,
      };
    }
    return {
      success: true,
      providerMessageId: `${MESSAGE_SINK_PROVIDER}-${randomUUID()}`,
      raw: { provider: MESSAGE_SINK_PROVIDER },
      outcome: 'ACCEPTED',
      segments:
        this.medium === CommunicationMedium.SMS
          ? countSmsSegments(params.body).segments
          : undefined,
    };
  }
}

/** Keeps the last 3 characters: `01711111111` -> `********111`. */
function maskRecipient(to: string): string {
  return to.length <= 3 ? '***' : '*'.repeat(to.length - 3) + to.slice(-3);
}
