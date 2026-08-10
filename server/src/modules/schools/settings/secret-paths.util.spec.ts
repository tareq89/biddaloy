import { describe, it, expect } from 'vitest';
import { getSecretPaths } from './secret-paths.util';
import { TenantSettingsDto } from '../dto/tenant-settings.dto';

describe('getSecretPaths', () => {
  it('finds every @Secret()-marked field across the nested settings tree', () => {
    const paths = getSecretPaths(TenantSettingsDto).sort();

    // This list is the credential inventory the rest of the epic is
    // driven from: every path here must be encrypted at rest (#8.7.8),
    // masked in API responses (#8.7.9), and redacted in the audit trail
    // (#8.7.11). A path that stops being reported here silently drops out
    // of all three at once, which is why this asserts the exact set
    // rather than merely containing each entry.
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

    // The inverse guarantee, and the one that keeps the feature usable:
    // a non-secret field pulled into secret handling would be encrypted
    // and then masked back to the dashboard as `••••`, so a school could
    // never read or re-edit its own phone number ID or gateway choice.
    expect(paths).not.toContain('version');
    expect(paths).not.toContain('region.locale');
    expect(paths).not.toContain('communications.whatsapp.phoneNumberId');
    expect(paths).not.toContain('communications.sms.provider');
  });
});
