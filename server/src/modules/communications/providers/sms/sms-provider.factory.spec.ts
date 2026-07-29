import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SmsProviderFactory } from './sms-provider.factory';

describe('SmsProviderFactory', () => {
  let config: Record<string, ReturnType<typeof vi.fn>>;
  let greenweb: Record<string, ReturnType<typeof vi.fn>>;
  let mimSms: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    config = { get: vi.fn() };
    greenweb = { sendSms: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'gw-1' }) };
    mimSms = { sendSms: vi.fn().mockResolvedValue({ success: true, providerMessageId: 'mim-1' }) };
  });

  it('defaults to greenweb when SMS_PROVIDER is unset', () => {
    config.get.mockReturnValue(undefined);

    const factory = new SmsProviderFactory(config as any, greenweb as any, mimSms as any);

    expect(factory.getActiveGatewayName()).toBe('greenweb');
  });

  it('routes to the MimSMS gateway when SMS_PROVIDER=mimsms', async () => {
    config.get.mockReturnValue('mimsms');

    const factory = new SmsProviderFactory(config as any, greenweb as any, mimSms as any);
    await factory.send({ to: '01712345678', body: 'hi' });

    expect(mimSms.sendSms).toHaveBeenCalledWith('01712345678', 'hi');
    expect(greenweb.sendSms).not.toHaveBeenCalled();
  });

  it('routes to the Greenweb gateway when SMS_PROVIDER=greenweb', async () => {
    config.get.mockReturnValue('greenweb');

    const factory = new SmsProviderFactory(config as any, greenweb as any, mimSms as any);
    await factory.send({ to: '01712345678', body: 'hi' });

    expect(greenweb.sendSms).toHaveBeenCalledWith('01712345678', 'hi');
    expect(mimSms.sendSms).not.toHaveBeenCalled();
  });

  it('setGateway swaps the active gateway at runtime', async () => {
    config.get.mockReturnValue('greenweb');
    const factory = new SmsProviderFactory(config as any, greenweb as any, mimSms as any);

    factory.setGateway('mimsms');
    await factory.send({ to: '01712345678', body: 'hi' });

    expect(factory.getActiveGatewayName()).toBe('mimsms');
    expect(mimSms.sendSms).toHaveBeenCalled();
  });

  it('rejects an unsupported gateway name', () => {
    config.get.mockReturnValue('greenweb');
    const factory = new SmsProviderFactory(config as any, greenweb as any, mimSms as any);

    expect(() => factory.setGateway('nonexistent')).toThrow(/not supported/);
  });
});
