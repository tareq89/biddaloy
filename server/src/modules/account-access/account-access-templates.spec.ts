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

describe('Epic 99 support-access templates', () => {
  const kinds: TemplateKind[] = [
    'SUPPORT_SESSION_OWNER_NOTICE',
    'SUPPORT_TICKET_READY',
    'PLATFORM_ANNOUNCEMENT',
  ];
  const vars = {
    school: 'SchoolManager',
    name: 'Owner',
    target_school: 'Rose School',
    role: 'Admin',
    person: 'Rafi',
    reason: 'Fee help',
    link: 'https://app.test/schools/1',
    title: 'Notice',
    message: 'Short text',
  };

  it('renders every kind in bn and en on both channels with no placeholder left', () => {
    for (const kind of kinds) {
      for (const medium of ['SMS', 'EMAIL'] as const) {
        for (const locale of ['bn', 'en'] as const) {
          const out = render(kind, medium, locale, vars);
          expect(out.body).not.toMatch(/\{\{/);
          expect(out.body.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('never carries a code and never uses a never-say word (D14, template text only)', () => {
    for (const kind of kinds) {
      for (const medium of ['SMS', 'EMAIL'] as const) {
        for (const locale of ['bn', 'en'] as const) {
          const out = render(kind, medium, locale, { ...vars, title: '', message: '' });
          const text = `${out.subject ?? ''} ${out.body}`;
          expect(text).not.toMatch(/impersonat|act as|break-glass|consent|session|revoke|#/i);
        }
      }
    }
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
