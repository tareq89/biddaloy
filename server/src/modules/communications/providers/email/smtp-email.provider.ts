import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  CommunicationProvider,
  CommunicationSendParams,
  CommunicationSendResult,
} from '../communication-provider.interface';

/**
 * Plain SMTP email — works against any SMTP endpoint (self-hosted,
 * SendGrid's SMTP relay, etc.), no vendor-specific SDK.
 */
@Injectable()
export class SmtpEmailProvider implements CommunicationProvider {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 587);
      this.transporter = nodemailer.createTransport({
        host: this.config.get<string>('SMTP_HOST'),
        port,
        secure: port === 465,
        auth: {
          user: this.config.get<string>('SMTP_USER'),
          pass: this.config.get<string>('SMTP_PASSWORD'),
        },
      });
    }
    return this.transporter;
  }

  async send(params: CommunicationSendParams): Promise<CommunicationSendResult> {
    try {
      const info = await this.getTransporter().sendMail({
        from: this.config.get<string>('SMTP_FROM'),
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
