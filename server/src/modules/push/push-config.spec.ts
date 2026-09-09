import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { PushConfigService } from './push-config';

// Real (but disposable) VAPID keypair — `web-push`'s setVapidDetails
// validates key shape, so a placeholder string like 'public-key' would
// throw when push is "enabled" in a test.
const { publicKey: VALID_PUBLIC_KEY, privateKey: VALID_PRIVATE_KEY } = webpush.generateVAPIDKeys();

/**
 * [#552] `isPushEnabled()` must be the single source of truth for whether
 * push sending is allowed: false whenever any of the three VAPID vars is
 * missing/empty, true only when all three are set. No throwing either way.
 */
describe('PushConfigService', () => {
  function makeService(env: Record<string, string>): PushConfigService {
    const config = new ConfigService(env);
    return new PushConfigService(config);
  }

  it('is disabled when no VAPID vars are set', () => {
    const service = makeService({});
    expect(service.isPushEnabled()).toBe(false);
  });

  it('is disabled when only some VAPID vars are set', () => {
    const service = makeService({
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      // VAPID_SUBJECT missing
    });
    expect(service.isPushEnabled()).toBe(false);
  });

  it('is disabled when a VAPID var is set but empty', () => {
    const service = makeService({
      VAPID_PUBLIC_KEY: 'public-key',
      VAPID_PRIVATE_KEY: 'private-key',
      VAPID_SUBJECT: '',
    });
    expect(service.isPushEnabled()).toBe(false);
  });

  it('is enabled when all three VAPID vars are set', () => {
    const service = makeService({
      VAPID_PUBLIC_KEY: VALID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: VALID_PRIVATE_KEY,
      VAPID_SUBJECT: 'mailto:admin@example.com',
    });
    expect(service.isPushEnabled()).toBe(true);
  });

  it('onModuleInit does not throw when push is disabled', () => {
    const service = makeService({});
    expect(() => service.onModuleInit()).not.toThrow();
  });

  it('onModuleInit does not throw when push is enabled', () => {
    const service = makeService({
      VAPID_PUBLIC_KEY: VALID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY: VALID_PRIVATE_KEY,
      VAPID_SUBJECT: 'mailto:admin@example.com',
    });
    expect(() => service.onModuleInit()).not.toThrow();
  });
});
