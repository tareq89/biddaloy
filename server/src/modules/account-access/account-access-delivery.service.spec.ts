import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommunicationMedium, CommunicationStatus } from '@biddaloy/shared';
import { AccountAccessDeliveryService, pickChannel } from './account-access-delivery.service';

function fakeLogRepo() {
  let saved: any = null;
  return {
    create: vi.fn((data: any) => ({ id: 'log-1', ...data })),
    save: vi.fn(async (row: any) => {
      saved = { ...saved, ...row };
      return saved;
    }),
    get saved() {
      return saved;
    },
  };
}

describe('AccountAccessDeliveryService', () => {
  let logRepo: ReturnType<typeof fakeLogRepo>;
  let registry: { resolve: ReturnType<typeof vi.fn> };
  let schoolsService: {
    getResolvedSettings: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let service: AccountAccessDeliveryService;

  beforeEach(() => {
    logRepo = fakeLogRepo();
    registry = { resolve: vi.fn() };
    schoolsService = {
      getResolvedSettings: vi.fn().mockResolvedValue({ region: { locale: 'en-US' } }),
      findById: vi.fn().mockResolvedValue({ id: 'tenant-1', name: 'Green Valley School' }),
    };
    service = new AccountAccessDeliveryService(
      logRepo as any,
      registry as any,
      schoolsService as any,
    );
  });

  it('stores a redacted message_body, never the raw link', async () => {
    const provider = {
      send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1' }),
    };
    registry.resolve.mockReturnValue(provider);

    await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.EMAIL,
      to: 'user@example.com',
      recipientName: 'Jane Doe',
      kind: 'INVITATION',
      vars: { link: 'https://app.example.com/activate?token=super-secret-raw-token' },
    });

    expect(logRepo.saved.message_body).toContain('••••••');
    expect(logRepo.saved.message_body).not.toContain('super-secret-raw-token');

    // The real, secret-bearing body only ever reaches the provider.
    const [sendParams] = provider.send.mock.calls[0];
    expect(sendParams.body).toContain('super-secret-raw-token');
  });

  it('marks the log SENT on a successful provider call', async () => {
    const provider = {
      send: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'p1' }),
    };
    registry.resolve.mockReturnValue(provider);

    const result = await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.EMAIL,
      to: 'user@example.com',
      recipientName: 'Jane Doe',
      kind: 'INVITATION',
      vars: { link: 'https://app.example.com/activate?token=abc' },
    });

    expect(result.status).toBe(CommunicationStatus.SENT);
    expect(logRepo.saved.status).toBe(CommunicationStatus.SENT);
  });

  it('marks the log FAILED when the provider reports failure, without persisting the raw provider error text', async () => {
    // A gateway can echo the request body — including this message's
    // secret-bearing link/OTP — back in its error text, so the stored
    // reason must be a fixed string, never `result.error` verbatim.
    const provider = {
      send: vi
        .fn()
        .mockResolvedValue({
          success: false,
          error: 'boom: link was https://x/activate?token=SECRET',
        }),
    };
    registry.resolve.mockReturnValue(provider);

    const result = await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.SMS,
      to: '+8801700000000',
      recipientName: 'Jane Doe',
      kind: 'OTP',
      vars: { code: '123456' },
    });

    expect(result.status).toBe(CommunicationStatus.FAILED);
    expect(logRepo.saved.metadata.error).toBe('Delivery failed');
  });

  it('marks the log FAILED without persisting the raw error text when the provider throws', async () => {
    const provider = {
      send: vi.fn().mockRejectedValue(new Error('boom: link was https://x/activate?token=SECRET')),
    };
    registry.resolve.mockReturnValue(provider);

    const result = await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.SMS,
      to: '+8801700000000',
      recipientName: 'Jane Doe',
      kind: 'OTP',
      vars: { code: '123456' },
    });

    expect(result.status).toBe(CommunicationStatus.FAILED);
    expect(logRepo.saved.metadata.error).toBe('Delivery failed');
  });

  it('marks the log FAILED without throwing when no provider is configured for the medium', async () => {
    registry.resolve.mockReturnValue(undefined);

    const result = await service.deliver({
      tenantId: 'tenant-1',
      medium: CommunicationMedium.SMS,
      to: '+8801700000000',
      recipientName: 'Jane Doe',
      kind: 'OTP',
      vars: { code: '123456' },
    });

    expect(result.status).toBe(CommunicationStatus.FAILED);
    expect(logRepo.saved.status).toBe(CommunicationStatus.FAILED);
  });
});

describe('pickChannel', () => {
  it('prefers EMAIL when the user has one', () => {
    expect(pickChannel({ email: 'a@b.com', phone: '01700000000' })).toEqual({
      medium: CommunicationMedium.EMAIL,
      to: 'a@b.com',
    });
  });

  it('falls back to SMS when there is no email', () => {
    expect(pickChannel({ email: null, phone: '01700000000' })).toEqual({
      medium: CommunicationMedium.SMS,
      to: '01700000000',
    });
  });

  it('returns null when there is neither', () => {
    expect(pickChannel({ email: null, phone: null })).toBeNull();
  });
});
