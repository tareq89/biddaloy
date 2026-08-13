import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { TenantProviderConfigResolver } from '../../config/tenant-provider-config.resolver';

/**
 * Plain SMTP email — works against any SMTP endpoint (self-hosted,
 * SendGrid's SMTP relay, etc.), no vendor-specific SDK.
 *
 * The transporter is built fresh per send from that tenant's resolved
 * config rather than cached on the instance — a single cached transporter
 * would silently reuse the first tenant's SMTP credentials for every
 * tenant after it (#8.7.10).
 */
@Injectable()
export class SmtpEmailProvider implements CommunicationProvider {
  constructor(private readonly configResolver: TenantProviderConfigResolver) {}

  async send(params: CommunicationSendParams, tenantId: string): Promise<CommunicationSendResult> {
    try {
      const { host, port, user, password, from } = await this.configResolver.resolveEmail(tenantId);
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass: password },
      });
      const info = await transporter.sendMail({
        from,
        to: params.to,
        subject: params.subject ?? '',
        text: params.body,
      });
      return {
        success: true,
        providerMessageId: info.messageId ?? null,
        raw: { response: info.response },
      };
    } catch (err) {
      return {
        success: false,
        providerMessageId: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
