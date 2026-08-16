import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as nodemailer from 'nodemailer';
import { SmtpEmailProvider } from './smtp-email.provider';
import { ProviderNotConfiguredError } from '../../config/provider-not-configured.error';
import {
  assertSafeSmtpDestination,
  DestinationBlockedError,
} from '../shared/outbound-destination-guard';

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(),
}));

// Destination-class validation (real vs. private-network host) is its own
// unit under test in outbound-destination-guard.spec.ts, and does a real
// DNS lookup — stub it out here so these tests stay hermetic and fast.
vi.mock('../shared/outbound-destination-guard', () => {
  class OutboundDestinationError extends Error {}
  class DestinationBlockedError extends OutboundDestinationError {}
  return {
    assertSafeSmtpDestination: vi
      .fn()
      .mockResolvedValue({ host: '203.0.113.5', servername: 'smtp.example.com' }),
    OutboundDestinationError,
    DestinationBlockedError,
  };
});

describe('SmtpEmailProvider', () => {
  const tenantId = 'tenant-1';
  let configResolver: Record<string, ReturnType<typeof vi.fn>>;
  let sendMail: ReturnType<typeof vi.fn>;
  let verify: ReturnType<typeof vi.fn>;
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
    verify = vi.fn().mockResolvedValue(true);
    vi.mocked(nodemailer.createTransport).mockReturnValue({ sendMail, verify } as any);
    provider = new SmtpEmailProvider(configResolver as any);
  });

  it('builds a transporter from the tenant-resolved config and sends the message', async () => {
    const result = await provider.send(
      { to: 'guardian@example.com', body: 'Fee reminder' },
      tenantId,
    );

    expect(configResolver.resolveEmail).toHaveBeenCalledWith(tenantId);
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: '203.0.113.5',
      port: 587,
      secure: false,
      auth: { user: 'user-1', pass: 'pass-1' },
      tls: { servername: 'smtp.example.com' },
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
    vi.mocked(assertSafeSmtpDestination).mockResolvedValueOnce({
      host: '198.51.100.9',
      servername: 'smtp.other-tenant.com',
    });
    await provider.send({ to: 'b@example.com', body: 'hi' }, 'tenant-2');

    expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
    expect(nodemailer.createTransport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        host: '198.51.100.9',
        tls: { servername: 'smtp.other-tenant.com' },
      }),
    );
  });

  it('returns success: false instead of throwing when the tenant is unconfigured', async () => {
    configResolver.resolveEmail.mockRejectedValue(
      new ProviderNotConfiguredError('Email', 'configure it'),
    );

    const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/configure it/);
    expect(result.retryable).toBe(false);
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });

  it('returns success: false instead of throwing when sendMail rejects', async () => {
    sendMail.mockRejectedValue(new Error('SMTP connection refused'));

    const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.error).toBe('SMTP connection refused');
    expect(result.retryable).toBeUndefined();
  });

  it('marks a destination-blocked failure as non-retryable', async () => {
    vi.mocked(assertSafeSmtpDestination).mockRejectedValueOnce(
      new DestinationBlockedError('"10.0.0.5" is a private/reserved address.'),
    );

    const result = await provider.send({ to: 'guardian@example.com', body: 'hi' }, tenantId);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
  });

  it('omits tls.servername when the tenant host is already a literal IP', async () => {
    vi.mocked(assertSafeSmtpDestination).mockResolvedValueOnce({
      host: '203.0.113.5',
      servername: undefined,
    });

    await provider.send({ to: 'guardian@example.com', body: 'hi' }, tenantId);

    const transportOptions = vi.mocked(nodemailer.createTransport).mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(transportOptions).not.toHaveProperty('tls');
  });

  describe('testConnection', () => {
    const config = {
      host: 'smtp.example.com',
      port: 587,
      user: 'user-1',
      password: 'super-secret-pass',
      from: 'noreply@example.com',
    };

    it('verifies the connection instead of sending mail', async () => {
      const result = await provider.testConnection(config);

      expect(verify).toHaveBeenCalledTimes(1);
      expect(sendMail).not.toHaveBeenCalled();
      expect(result).toEqual({ success: true, message: 'Connected — SMTP credentials verified.' });
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ host: '203.0.113.5', tls: { servername: 'smtp.example.com' } }),
      );
    });

    it('reports an authentication-rejected message for an EAUTH failure, never the raw error', async () => {
      const authError = Object.assign(
        new Error(`535 Authentication failed for ${config.password}`),
        {
          code: 'EAUTH',
        },
      );
      verify.mockRejectedValue(authError);

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe(
        'Authentication rejected — check the SMTP username and password.',
      );
      expect(result.message).not.toContain(config.password);
    });

    it('reports an unreachable-server message for a connection failure', async () => {
      verify.mockRejectedValue(
        Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNECTION' }),
      );

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Could not reach the SMTP server — check the host and port.');
    });

    it('falls back to a generic message for an unrecognized error code', async () => {
      verify.mockRejectedValue(new Error('something unexpected'));

      const result = await provider.testConnection(config);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Connection test failed — could not verify the credentials.');
    });
  });
});
