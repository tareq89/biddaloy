import { describe, it, expect } from 'vitest';
import { buildIssuerSnapshot, resolveIssuer } from './issuer-snapshot';

function school(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: 'Green Valley School',
    name_bn: 'গ্রিন ভ্যালি স্কুল',
    address: '123 Main St',
    phone: '+8801700000000',
    email: 'info@example.com',
    registration_id: 'EIIN-12345',
    logo_key: 'tenants/x/logo/abc.png',
    ...overrides,
  };
}

describe('buildIssuerSnapshot', () => {
  it('copies every identity field and stamps captured_at', () => {
    const before = Date.now();
    const snapshot = buildIssuerSnapshot(school());
    const after = Date.now();

    expect(snapshot).toMatchObject({
      name: 'Green Valley School',
      name_bn: 'গ্রিন ভ্যালি স্কুল',
      address: '123 Main St',
      phone: '+8801700000000',
      email: 'info@example.com',
      registration_id: 'EIIN-12345',
      logo_key: 'tenants/x/logo/abc.png',
    });
    const capturedAt = new Date(snapshot.captured_at).getTime();
    expect(capturedAt).toBeGreaterThanOrEqual(before);
    expect(capturedAt).toBeLessThanOrEqual(after);
  });

  it('preserves nulls rather than coercing them', () => {
    const snapshot = buildIssuerSnapshot(
      school({
        name_bn: null,
        address: null,
        phone: null,
        email: null,
        registration_id: null,
        logo_key: null,
      }),
    );

    expect(snapshot.name_bn).toBeNull();
    expect(snapshot.logo_key).toBeNull();
  });
});

describe('resolveIssuer', () => {
  it('returns the frozen snapshot when the document has one, ignoring the live profile', () => {
    const frozenSnapshot = buildIssuerSnapshot(school({ name: 'Old Name At Issue Time' }));
    const doc = { issuer_snapshot: frozenSnapshot };
    const liveSchool = school({ name: 'New Name After Edit' });

    const result = resolveIssuer(doc, liveSchool);

    expect(result.name).toBe('Old Name At Issue Time');
  });

  it('falls back to the live profile when the document has no snapshot', () => {
    const doc = { issuer_snapshot: null };
    const liveSchool = school({ name: 'Current Name' });

    const result = resolveIssuer(doc, liveSchool);

    expect(result.name).toBe('Current Name');
  });
});
