import { redact, render, resolveTemplateLocale, TemplateKind } from './account-access-templates';

describe('cockpit templates', () => {
  const kinds: TemplateKind[] = [
    'COCKPIT_DEVICE_CODE',
    'COCKPIT_ENROL_CODE',
    'COCKPIT_SIGNIN_NOTICE',
    'COCKPIT_RECOVERY_NOTICE',
    'COCKPIT_LOCKOUT_ALERT',
  ];

  it('renders every kind in bn and en on both channels with no leftover placeholder', () => {
    for (const kind of kinds) {
      for (const medium of ['SMS', 'EMAIL'] as const) {
        for (const locale of ['bn', 'en'] as const) {
          const out = render(kind, medium, locale, {
            school: 'SchoolManager',
            name: 'Owner',
            code: '123456',
            detail: 'IP 1.2.3.4',
            count: '7',
          });
          expect(out.body).not.toMatch(/\{\{/);
        }
      }
    }
  });

  it('redact hides the code in the code messages', () => {
    const out = redact('COCKPIT_DEVICE_CODE', 'SMS', 'en', {
      school: 'SchoolManager',
      name: 'Owner',
      code: '123456',
    });
    expect(out.body).not.toContain('123456');
  });
});

describe('resolveTemplateLocale', () => {
  it('maps a bn region locale to Bangla, ignoring case', () => {
    expect(resolveTemplateLocale('bn-BD')).toBe('bn');
    expect(resolveTemplateLocale('BN')).toBe('bn');
  });

  it('maps any other stored locale to English', () => {
    expect(resolveTemplateLocale('en-BD')).toBe('en');
    expect(resolveTemplateLocale('en-US')).toBe('en');
  });

  // [#3136] Raw stored settings are untyped: a missing locale means the platform default
  // region (bn-BD), the same answer resolveTenantSettings gives, not English.
  it('falls back to the default region (Bangla) for undefined', () => {
    expect(resolveTemplateLocale(undefined)).toBe('bn');
  });

  it('falls back to the default region (Bangla) for null', () => {
    expect(resolveTemplateLocale(null)).toBe('bn');
  });

  it('falls back to the default region (Bangla) for an empty string', () => {
    expect(resolveTemplateLocale('')).toBe('bn');
  });

  it('falls back to the default region (Bangla) for a non-string value', () => {
    expect(resolveTemplateLocale(42)).toBe('bn');
  });
});
