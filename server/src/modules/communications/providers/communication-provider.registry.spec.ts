import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommunicationProviderRegistryService } from './communication-provider.registry';
import { CommunicationMedium } from '@biddaloy/shared';
import { MailpitSinkProvider } from './sink/mailpit-sink.provider';

describe('CommunicationProviderRegistryService', () => {
  const smsProviderFactory = { send: () => Promise.resolve() } as any;
  const whatsAppCloudProvider = {
    sendForTenant: vi.fn().mockResolvedValue({ success: true }),
  } as any;
  const smtpEmailProvider = { sendForTenant: vi.fn().mockResolvedValue({ success: true }) } as any;
  const messengerProvider = { sendForTenant: vi.fn().mockResolvedValue({ success: true }) } as any;

  const build = () =>
    new CommunicationProviderRegistryService(
      smsProviderFactory,
      whatsAppCloudProvider,
      smtpEmailProvider,
      messengerProvider,
    );
  const registry = build();

  afterEach(() => vi.unstubAllEnvs());

  // Epic 87: with the sink on, nothing leaves the server, whatever tenant or env config says.
  it('with MESSAGE_SINK=mailpit, every medium resolves to the sink, not the real providers', () => {
    vi.stubEnv('MESSAGE_SINK', 'mailpit');
    const sink = build();
    for (const medium of [
      CommunicationMedium.SMS,
      CommunicationMedium.WHATSAPP,
      CommunicationMedium.EMAIL,
      CommunicationMedium.MESSENGER,
    ]) {
      expect(sink.resolve(medium)).toBeInstanceOf(MailpitSinkProvider);
    }
    expect(sink.resolve(CommunicationMedium.PHONE_CALL)).toBeUndefined();
  });

  it('with MESSAGE_SINK unset, the real providers are untouched', () => {
    vi.stubEnv('MESSAGE_SINK', '');
    expect(build().resolve(CommunicationMedium.SMS)).toBe(smsProviderFactory);
  });

  it('DEMO_MODE=true alone no longer swaps providers', () => {
    vi.stubEnv('MESSAGE_SINK', '');
    vi.stubEnv('DEMO_MODE', 'true');
    expect(build().resolve(CommunicationMedium.SMS)).toBe(smsProviderFactory);
  });

  it('resolves SMS to the SMS provider factory', () => {
    expect(registry.resolve(CommunicationMedium.SMS)).toBe(smsProviderFactory);
  });

  it('resolves WHATSAPP to the WhatsApp Cloud provider', async () => {
    // W1 bridge: the registry entry forwards (params, tenantId) to sendForTenant.
    const params = { to: 'x', body: 'hi' };
    // The wrapper must hand the provider result back to the processor.
    expect(await registry.resolve(CommunicationMedium.WHATSAPP)!.send(params, 't-1')).toEqual({ success: true });
    expect(whatsAppCloudProvider.sendForTenant).toHaveBeenCalledWith(params, 't-1');
  });

  it('resolves EMAIL to the SMTP provider', async () => {
    // W1 bridge: the registry entry forwards (params, tenantId) to sendForTenant.
    const params = { to: 'x', body: 'hi' };
    // The wrapper must hand the provider result back to the processor.
    expect(await registry.resolve(CommunicationMedium.EMAIL)!.send(params, 't-1')).toEqual({ success: true });
    expect(smtpEmailProvider.sendForTenant).toHaveBeenCalledWith(params, 't-1');
  });

  it('resolves MESSENGER to the Messenger stub provider', async () => {
    // W1 bridge: the registry entry forwards (params, tenantId) to sendForTenant.
    const params = { to: 'x', body: 'hi' };
    // The wrapper must hand the provider result back to the processor.
    expect(await registry.resolve(CommunicationMedium.MESSENGER)!.send(params, 't-1')).toEqual({ success: true });
    expect(messengerProvider.sendForTenant).toHaveBeenCalledWith(params, 't-1');
  });

  it('returns undefined for a medium with no registered provider', () => {
    expect(registry.resolve(CommunicationMedium.PHONE_CALL)).toBeUndefined();
  });
});
