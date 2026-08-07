import { describe, it, expect } from 'vitest';
import { getSecretPaths } from './secret-paths.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

describe('getSecretPaths', () => {
  it('finds every @Secret()-marked field across the nested settings tree', () => {
    const paths = getSecretPaths(TenantSettingsDto).sort();

    expect(paths).toEqual(
      [
        'communications.sms.greenweb.apiKey',
        'communications.sms.mimsms.apiKey',
        'communications.whatsapp.accessToken',
        'communications.email.password',
        'communications.messenger.accessToken',
      ].sort(),
    );
  });

  it('never reports a non-secret field', () => {
    const paths = getSecretPaths(TenantSettingsDto);

    expect(paths).not.toContain('version');
    expect(paths).not.toContain('region.locale');
    expect(paths).not.toContain('communications.whatsapp.phoneNumberId');
    expect(paths).not.toContain('communications.sms.provider');
  });
});
