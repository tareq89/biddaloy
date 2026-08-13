import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';
import { ConnectionTestResult } from '../shared/connection-test.types';
import {
  ResolvedEmailConfig,
  TenantProviderConfigResolver,
} from '../../config/tenant-provider-config.resolver';

function mapSmtpError(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'EAUTH') {
    return 'Authentication rejected — check the SMTP username and password.';
  }
  if (code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'EDNS') {
    return 'Could not reach the SMTP server — check the host and port.';
  }
  return 'Connection test failed — could not verify the credentials.';
}

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

  /**
   * #8.7.12's connection test — `transporter.verify()` is nodemailer's own
   * cheapest check: it opens the connection and authenticates without
   * sending a message. `config` can be an unsaved draft or the tenant's
   * stored config; this method doesn't care which.
   */
  async testConnection(config: ResolvedEmailConfig): Promise<ConnectionTestResult> {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    });

    try {
      await transporter.verify();
      return { success: true, message: 'Connected — SMTP credentials verified.' };
    } catch (err) {
      return { success: false, message: mapSmtpError(err) };
    }
  }
}
