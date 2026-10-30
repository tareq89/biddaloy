import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { ConnectionTestService, TEST_SENDS_PER_DAY } from './connection-test.service';
import { ProviderNotConfiguredError } from '../config/provider-not-configured.error';

vi.mock('@sentry/node', () => ({ withScope: vi.fn(), captureException: vi.fn() }));

describe('ConnectionTestService', () => {
  const tenantId = 'tenant-1';
  let registry: { resolveFor: ReturnType<typeof vi.fn> };
  let provider: { testConnection: ReturnType<typeof vi.fn> };
  let service: ConnectionTestService;
  let logs: {
    create: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    createQueryBuilder: ReturnType<typeof vi.fn>;
  };
  let usedToday: number;
  let credits: { reserveIfMetered: ReturnType<typeof vi.fn>; settlePart: ReturnType<typeof vi.fn> };
  let sendSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendSpy = vi
      .fn()
      .mockResolvedValue({ success: true, providerMessageId: 'pm-1', outcome: 'ACCEPTED' });
    provider = {
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
      send: sendSpy,
      descriptor: { medium: CommunicationMedium.SMS, supportsTestMessage: true },
    } as any;
    registry = { resolveFor: vi.fn().mockResolvedValue({ provider, config: { k: 'v' } }) };
    logs = {
      create: vi.fn((x) => x),
      save: vi.fn(async (x) => ({ id: 'log-1', ...x })),
      createQueryBuilder: vi.fn(() => {
        const qb: any = { where: () => qb, andWhere: () => qb, getCount: async () => usedToday };
        return qb;
      }),
    };
    usedToday = 0;
    credits = {
      reserveIfMetered: vi.fn().mockResolvedValue('UNMETERED'),
      settlePart: vi.fn().mockResolvedValue(undefined),
    };
    const schools = { findOne: vi.fn().mockResolvedValue({ id: tenantId, name: 'Green School' }) };
    service = new ConnectionTestService(
      registry as any,
      logs as any,
      schools as any,
      credits as any,
    );
  });

  it.each([
    CommunicationMedium.SMS,
    CommunicationMedium.WHATSAPP,
    CommunicationMedium.EMAIL,
    CommunicationMedium.MESSENGER,
  ])("resolves this tenant's provider for %s and tests the resolved config", async (medium) => {
    const result = await service.test(tenantId, medium as never);

    // Tenant-scoped: the id the caller passed is the id resolved against.
    expect(registry.resolveFor).toHaveBeenCalledWith(medium, tenantId, { override: undefined });
    expect(provider.testConnection).toHaveBeenCalledWith({ k: 'v' });
    expect(result).toEqual({ success: true, message: 'ok' });
  });

  it('passes an unsaved override through to the resolver', async () => {
    const override = { accessToken: 'draft-token' };

    await service.test(tenantId, CommunicationMedium.WHATSAPP, override);

    expect(registry.resolveFor).toHaveBeenCalledWith(CommunicationMedium.WHATSAPP, tenantId, {
      override,
    });
  });

  it('returns a failure result instead of throwing when the tenant is unconfigured', async () => {
    registry.resolveFor.mockRejectedValue(
      new ProviderNotConfiguredError('WhatsApp', 'configure it'),
    );

    const result = await service.test(tenantId, CommunicationMedium.WHATSAPP);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/configure it/);
    expect(provider.testConnection).not.toHaveBeenCalled();
  });

  describe('send a test message (97.3.04)', () => {
    const req = { sendTo: '01712345678', userId: 'user-1' };

    it('refuses sendTo for a provider without test-message support, before any outbound call', async () => {
      (provider as any).descriptor.supportsTestMessage = false;
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(provider.testConnection).not.toHaveBeenCalled();
    });

    it('rejects a malformed number with a sentence that does not echo it', async () => {
      const bad = { sendTo: 'not-a-phone-9999', userId: 'user-1' };
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, bad)
        .catch((e) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect(JSON.stringify(err.getResponse())).not.toContain('9999');
    });

    it('sends nothing when the connection test fails', async () => {
      provider.testConnection.mockResolvedValue({ success: false, message: 'bad key' });
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(result.testMessage).toBeUndefined();
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('sends through the resolved override config and logs one test row', async () => {
      const override = { onecodesoft: { apiKey: 'draft' } };
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, override, req);

      expect(registry.resolveFor).toHaveBeenCalledWith(CommunicationMedium.SMS, tenantId, {
        override,
      });
      // The config that reaches the provider is the resolved one (override already merged in).
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '01712345678',
          body: expect.stringContaining('Green School'),
        }),
        { k: 'v' },
      );
      expect(logs.save).toHaveBeenCalledTimes(1);
      expect(logs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: tenantId,
          recipient_name: 'Test',
          sent_by_user_id: 'user-1',
          trigger: 'MANUAL',
          status: 'SENT',
          metadata: expect.objectContaining({ test: true }),
        }),
      );
      expect(result.testMessage).toEqual({ logId: 'log-1', status: 'SENT' });
    });

    it('debits a reserved credit on success and releases it on a rejected send', async () => {
      credits.reserveIfMetered.mockResolvedValue('RESERVED');
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(credits.settlePart).toHaveBeenLastCalledWith(
        tenantId,
        expect.stringMatching(/^batch:/),
        'log:log-1',
        expect.any(Number),
        'DEBIT',
      );

      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'no',
        outcome: 'REJECTED',
      });
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(credits.settlePart).toHaveBeenLastCalledWith(
        tenantId,
        expect.any(String),
        'log:log-1',
        expect.any(Number),
        'RELEASE',
      );
    });

    it('caps real test sends per tenant per day with a fixed 429 sentence, before any outbound call', async () => {
      usedToday = TEST_SENDS_PER_DAY;
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, req)
        .catch((e) => e);
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      expect(JSON.stringify(err.getResponse())).not.toContain('01712345678');
      expect(provider.testConnection).not.toHaveBeenCalled();
      expect(sendSpy).not.toHaveBeenCalled();
      usedToday = TEST_SENDS_PER_DAY - 1;
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(sendSpy).toHaveBeenCalledTimes(1);
    });

    it('maps a credit/DB error after a passing connection test to its own fixed 500, not "Connection test failed."', async () => {
      credits.reserveIfMetered.mockRejectedValue(new Error('db down host=secret-db'));
      const err = await service
        .test(tenantId, CommunicationMedium.SMS as never, undefined, req)
        .catch((e) => e);
      expect(err).toBeInstanceOf(InternalServerErrorException);
      expect(JSON.stringify(err.getResponse())).toBe(
        JSON.stringify(
          new InternalServerErrorException('The test message could not be sent.').getResponse(),
        ),
      );
      expect(sendSpy).not.toHaveBeenCalled();
    });

    it('releases the reservation when the log save fails after a REJECTED send', async () => {
      credits.reserveIfMetered.mockResolvedValue('RESERVED');
      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'no',
        outcome: 'REJECTED',
      });
      logs.save.mockRejectedValue(new Error('db'));
      credits.releaseForLog = vi.fn().mockResolvedValue(undefined);
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(credits.releaseForLog).toHaveBeenCalledTimes(1);
    });

    it('alerts ops (Sentry, ids only) and keeps the reservation when an AMBIGUOUS send cannot be logged', async () => {
      credits.reserveIfMetered.mockResolvedValue('RESERVED');
      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'x',
        outcome: 'AMBIGUOUS',
      });
      logs.save.mockRejectedValue(new Error('db'));
      credits.releaseForLog = vi.fn();
      const tags = vi.fn();
      vi.mocked(Sentry.withScope).mockImplementation(((cb: any) => cb({ setTags: tags })) as never);
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
      expect(credits.releaseForLog).not.toHaveBeenCalled();
      expect(tags).toHaveBeenCalledWith(
        expect.objectContaining({ needs_reconciliation: 'true', tenant_id: tenantId }),
      );
      expect(JSON.stringify(tags.mock.calls)).not.toContain('01712345678');
    });

    it('leaves an ambiguous send unsettled and fails 409 when credit is short', async () => {
      credits.reserveIfMetered.mockResolvedValue('RESERVED');
      sendSpy.mockResolvedValue({
        success: false,
        providerMessageId: null,
        error: 'x',
        outcome: 'AMBIGUOUS',
      });
      await service.test(tenantId, CommunicationMedium.SMS as never, undefined, req);
      expect(credits.settlePart).not.toHaveBeenCalled();

      credits.reserveIfMetered.mockResolvedValue({ insufficient: true, available: 0 });
      await expect(
        service.test(tenantId, CommunicationMedium.SMS as never, undefined, req),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  it('maps an unexpected throw to fixed text that never echoes its message', async () => {
    registry.resolveFor.mockRejectedValue(new Error('connect ECONNREFUSED key=sk-secret'));
    const result = await service.test(tenantId, CommunicationMedium.SMS as never);
    expect(result).toEqual({ success: false, message: 'Connection test failed.' });
  });

  describe('test inbox (Epic 87, D24)', () => {
    afterEach(() => {
      delete process.env.MESSAGE_SINK;
    });

    it('says no real message was sent when sendTo is given on a sink stack, and sends nothing', async () => {
      process.env.MESSAGE_SINK = 'mailpit';
      const result = await service.test(tenantId, CommunicationMedium.SMS as never, undefined, {
        sendTo: '01712345678',
        userId: 'user-1',
      });
      expect(result).toEqual({
        success: true,
        message: 'Test site: messages go to the test inbox. No real message was sent.',
      });
      expect(sendSpy).not.toHaveBeenCalled();
      expect(logs.save).not.toHaveBeenCalled();
    });

    it.each([
      CommunicationMedium.WHATSAPP,
      CommunicationMedium.EMAIL,
      CommunicationMedium.MESSENGER,
      CommunicationMedium.SMS,
    ])('returns the fixed success text for %s without resolving any config', async (medium) => {
      process.env.MESSAGE_SINK = 'mailpit';

      const result = await service.test(tenantId, medium as never, { accessToken: 'x' });

      expect(result).toEqual({
        success: true,
        message: 'Test site: messages go to the test inbox',
      });
      expect(registry.resolveFor).not.toHaveBeenCalled();
    });
  });
});
