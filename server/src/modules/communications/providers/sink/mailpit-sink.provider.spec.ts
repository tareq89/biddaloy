import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as nodemailer from 'nodemailer';
import { Logger } from '@nestjs/common';
import { CommunicationMedium } from '@biddaloy/shared';
import { MailpitSinkProvider } from './mailpit-sink.provider';

vi.mock('nodemailer', () => ({ createTransport: vi.fn() }));

describe('MailpitSinkProvider', () => {
  let sendMail: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendMail = vi.fn().mockResolvedValue({ messageId: 'm' });
    vi.mocked(nodemailer.createTransport).mockReset();
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as any);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('EMAIL keeps to, subject and body; tagged EMAIL; default SMTP url', async () => {
    const result = await MailpitSinkProvider.forMedium(CommunicationMedium.EMAIL).send({
      to: 'g@example.com',
      subject: 'Hello',
      body: 'Your code is 123456',
    });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ url: 'smtp://mailpit:1025', connectionTimeout: 5000 }));
    expect(sendMail).toHaveBeenCalledWith({
      from: 'email@sink.invalid',
      to: 'g@example.com',
      subject: 'Hello',
      text: 'Your code is 123456',
      headers: { 'X-Tags': 'EMAIL' },
    });
    expect(result).toMatchObject({
      success: true,
      outcome: 'ACCEPTED',
      raw: { provider: 'mailpit-sink' },
      segments: undefined,
    });
    expect(result.providerMessageId).toMatch(/^mailpit-sink-/);
  });

  it('honours MESSAGE_SINK_SMTP_URL', async () => {
    vi.stubEnv('MESSAGE_SINK_SMTP_URL', 'smtp://localhost:2525');
    await new MailpitSinkProvider(CommunicationMedium.EMAIL).send({ to: 'a@b.c', body: 'x' });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ url: 'smtp://localhost:2525', connectionTimeout: 5000 }));
  });

  it('SMS maps the number to a sink address, tags SMS and counts segments', async () => {
    const result = await MailpitSinkProvider.forMedium(CommunicationMedium.SMS).send({
      to: '01711111111',
      body: 'Code 123456',
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '01711111111@sms.sink.invalid',
        subject: '[SMS] to 01711111111',
        text: 'Code 123456',
        headers: { 'X-Tags': 'SMS' },
      }),
    );
    expect(result.segments).toBe(1);
  });

  it('WhatsApp template send renders the template subject and params', async () => {
    await MailpitSinkProvider.forMedium(CommunicationMedium.WHATSAPP).send({
      to: '8801711111111',
      body: '',
      templateName: 'fee_due',
      templateLanguage: 'bn',
      templateParams: ['Rahim', '500'],
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '[WhatsApp template fee_due]',
        text: 'language: bn\nRahim\n500',
        headers: { 'X-Tags': 'WHATSAPP' },
      }),
    );
  });

  it('transport error -> REJECTED, not retryable, and logs neither body nor full recipient', async () => {
    sendMail.mockRejectedValue(new Error('ECONNREFUSED'));
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const result = await MailpitSinkProvider.forMedium(CommunicationMedium.SMS).send({
      to: '01711111111',
      body: 'SECRET-OTP-987654',
    });
    expect(result).toEqual({
      success: false,
      error: 'Test inbox unreachable',
      retryable: false,
      outcome: 'REJECTED',
      providerMessageId: null,
    });
    const logged = JSON.stringify([...warn.mock.calls, ...log.mock.calls]);
    expect(logged).not.toContain('SECRET-OTP-987654');
    expect(logged).not.toContain('01711111111');
  });
});
