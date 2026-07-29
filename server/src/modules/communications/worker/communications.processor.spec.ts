import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CommunicationsProcessor } from './communications.processor';
import { CommunicationMedium, CommunicationStatus } from '@beton-boi/shared';

describe('CommunicationsProcessor', () => {
  let processor: CommunicationsProcessor;
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let providerRegistry: Record<string, ReturnType<typeof vi.fn>>;
  let provider: Record<string, ReturnType<typeof vi.fn>>;

  const baseLog = {
    id: 'log-1',
    medium: CommunicationMedium.SMS,
    recipient_address: '01712345678',
    message_body: 'Hello',
    subject: null,
    metadata: null,
  };

  beforeEach(() => {
    provider = { send: vi.fn() };
    repo = {
      findOneOrFail: vi.fn(async () => ({ ...baseLog })),
      save: vi.fn(async (log) => log),
    };
    providerRegistry = { resolve: vi.fn(() => provider) };

    processor = new CommunicationsProcessor(repo as any, providerRegistry as any);
  });

  it('marks the log SENT with the provider message id on success', async () => {
    provider.send.mockResolvedValue({ success: true, providerMessageId: 'p-1', raw: { ok: true } });

    await processor.process({ data: { logId: 'log-1' } } as any);

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({ status: CommunicationStatus.SENT, provider_message_id: 'p-1' }),
    );
  });

  it('marks the log FAILED without throwing when the provider reports failure', async () => {
    provider.send.mockResolvedValue({ success: false, providerMessageId: null, error: 'gateway down' });

    await expect(processor.process({ data: { logId: 'log-1' } } as any)).resolves.toBeUndefined();

    expect(repo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: CommunicationStatus.FAILED,
        metadata: expect.objectContaining({ error: 'gateway down' }),
      }),
    );
  });

  it('marks the log FAILED when no provider is registered for the medium', async () => {
    providerRegistry.resolve.mockReturnValue(undefined);

    await processor.process({ data: { logId: 'log-1' } } as any);

    expect(provider.send).not.toHaveBeenCalled();
    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: CommunicationStatus.FAILED }));
  });

  it('passes template fields from metadata through to the provider', async () => {
    repo.findOneOrFail.mockResolvedValue({
      ...baseLog,
      medium: CommunicationMedium.WHATSAPP,
      metadata: { template_name: 'fee_reminder', template_language: 'bn', template_params: ['500'] },
    });
    provider.send.mockResolvedValue({ success: true, providerMessageId: 'wa-1' });

    await processor.process({ data: { logId: 'log-1' } } as any);

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'fee_reminder',
        templateLanguage: 'bn',
        templateParams: ['500'],
      }),
    );
  });
});
