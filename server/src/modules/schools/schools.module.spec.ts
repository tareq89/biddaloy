import { describe, it, expect } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { encryptionServiceFactory } from './schools.module';

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe('encryptionServiceFactory', () => {
  it('produces an EncryptionService that throws on encrypt when no key is configured in development', () => {
    const service = encryptionServiceFactory(fakeConfig({ NODE_ENV: 'development' }));

    expect(() => service.encrypt('secret')).toThrow(/not configured/);
  });

  it('refuses to build at all when no key is configured in production', () => {
    expect(() => encryptionServiceFactory(fakeConfig({ NODE_ENV: 'production' }))).toThrow(
      /SETTINGS_ENCRYPTION_KEY must be set in production/,
    );
  });

  it('produces a working EncryptionService when a key is configured', () => {
    const key = randomBytes(32).toString('base64');
    const service = encryptionServiceFactory(
      fakeConfig({ NODE_ENV: 'development', SETTINGS_ENCRYPTION_KEY: key }),
    );

    expect(service.decrypt(service.encrypt('secret'))).toBe('secret');
  });

  it('wires SETTINGS_ENCRYPTION_KEY_PREVIOUS through so a rotated-out key still decrypts', () => {
    const oldKey = randomBytes(32).toString('base64');
    const newKey = randomBytes(32).toString('base64');
    const before = encryptionServiceFactory(
      fakeConfig({ NODE_ENV: 'development', SETTINGS_ENCRYPTION_KEY: oldKey }),
    );
    const envelope = before.encrypt('rotate-me');

    const after = encryptionServiceFactory(
      fakeConfig({
        NODE_ENV: 'development',
        SETTINGS_ENCRYPTION_KEY: newKey,
        SETTINGS_ENCRYPTION_KEY_PREVIOUS: oldKey,
      }),
    );

    expect(after.decrypt(envelope)).toBe('rotate-me');
  });
});
