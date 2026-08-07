import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as nodemailer from 'nodemailer';
import { SmtpEmailProvider } from './smtp-email.provider';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(),
}));

describe('SmtpEmailProvider', () => {
  const tenantId = 'tenant-1';
  let configResolver: Record<string, ReturnType<typeof vi.fn>>;
  let sendMail: ReturnType<typeof vi.fn>;
  let provider: SmtpEmailProvider;

  beforeEach(() => {
    vi.mocked(nodemailer.createTransport).mockClear();
    configResolver = {
      resolveEmail: vi.fn().mockResolvedValue({
        host: 'smtp.example.com',
        port: 587,
        user: 'user-1',
        password: 'pass-1',
        from: 'noreply@example.com',
      }),
    };
    sendMail = vi.fn().mockResolvedValue({ messageId: 'msg-1', response: '250 OK' });
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail } as any);
    provider = new SmtpEmailProvider(configResolver as any);
  });

  it('builds a transporter from the tenant-resolved config and sends the message', async () => {
    const result = await provider.send(
      { to: 'guardian@example.com', body: 'Fee reminder' },
      tenantId,
    );

    expect(configResolver.resolveEmail).toHaveBeenCalledWith(tenantId);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'user-1', pass: 'pass-1' },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'noreply@example.com',
      to: 'guardian@example.com',
      subject: '',
      text: 'Fee reminder',
    });
    expect(result).toEqual({
      success: true,
      providerMessageId: 'msg-1',
      raw: { response: '250 OK' },
    });
  });

  it('marks the transport secure for port 465', async () => {
    configResolver.resolveEmail.mockResolvedValue({
      host: 'smtp.example.com',
      port: 465,
      user: 'user-1',
      password: 'pass-1',
      from: 'noreply@example.com',
    });

    await provider.send({ to: 'guardian@example.com', body: 'hi' }, tenantId);

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true }),
    );
  });

  it('builds a fresh transporter per tenant rather than reusing a cached one', async () => {
    await provider.send({ to: 'a@example.com', body: 'hi' }, tenantId);

    configResolver.resolveEmail.mockResolvedValue({
      host: 'smtp.other-tenant.com',
      port: 587,
      user: 'other-user',
      password: 'other-pass',
      from: 'noreply@other-tenant.com',
    });
    await provider.send({ to: 'b@example.com', body: 'hi' }, 'tenant-2');

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({ host: 'smtp.other-tenant.com' }),
    );
  });

  it('returns success: false instead of throwing when the tenant is unconfigured', async () => {
    configResolver.resolveEmail.mockRejectedValue(
      new ProviderNotConfiguredError('Email', 'configure it'),
    );

    const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/configure it/);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('returns success: false instead of throwing when sendMail rejects', async () => {
    sendMail.mockRejectedValue(new Error('SMTP connection refused'));

    const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('SMTP connection refused');
  });
});
