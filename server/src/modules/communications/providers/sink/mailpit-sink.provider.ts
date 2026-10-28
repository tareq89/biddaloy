import { randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { CommunicationMedium, countSmsSegments } from '@biddaloy/shared';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { maskEmail, maskPhone } from '../../../account-access/contact-mask.util';
import { MESSAGE_SINK_PROVIDER } from './message-sink';

const DEFAULT_SMTP_URL = 'smtp://mailpit:1025';

// nodemailer's codes for "never reached Mailpit" (it rewrites ECONNREFUSED / ECONNRESET to
// ESOCKET or ECONNECTION, EAI_AGAIN to EDNS, and keeps ETIMEDOUT): Mailpit restarting.
const TRANSIENT_CODES = new Set(['ECONNECTION', 'ESOCKET', 'ETIMEDOUT', 'EDNS']);

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
        : // No recipient here: the public demo inbox lists subjects; it is searchable by To.
          `[${this.medium}]`;
    const text = isTemplate
      ? [`language: ${params.templateLanguage ?? ''}`, ...(params.templateParams ?? [])].join('\n')
      : params.body;
    try {
      const transport = nodemailer.createTransport({
        url: process.env.MESSAGE_SINK_SMTP_URL || DEFAULT_SMTP_URL,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
      await transport.sendMail({
        from: `${this.medium.toLowerCase()}@sink.invalid`,
        to: isEmail ? params.to : `${params.to}@sms.sink.invalid`,
        subject,
        text,
        headers: { 'X-Tags': this.medium },
      });
    } catch (err) {
      // Never log the body or the full recipient.
      this.logger.warn(`sink send failed (${this.medium}) to ${maskRecipient(params.to)}`);
      const code = (err as { code?: unknown } | null)?.code;
      const transient = typeof code === 'string' && TRANSIENT_CODES.has(code);
      return {
        success: false,
        error: 'Test inbox unreachable',
        // A connection-level failure (Mailpit restarting) stays retryable; anything else is final.
        retryable: transient ? undefined : false,
        // REJECTED even when retryable, unlike a real gateway: nothing was delivered, so on the
        // last attempt the SMS reservation is released, not left for reconciliation.
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

function maskRecipient(to: string): string {
  return to.includes('@') ? maskEmail(to) : maskPhone(to);
}
