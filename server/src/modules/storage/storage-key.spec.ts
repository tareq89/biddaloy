import { describe, expect, it } from 'vitest';
import { tenantObjectKey } from './storage-key';

const VALID_TENANT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('tenantObjectKey', () => {
  it('builds a tenants/<uuid>/<category>/<uuid>.<ext> key', () => {
    const key = tenantObjectKey(VALID_TENANT_ID, 'avatars', 'png');
    expect(key).toMatch(
      new RegExp(
        `^tenants/${VALID_TENANT_ID}/avatars/[0-9a-f-]{36}\\.png$`,
      ),
    );
  });

  it('generates a different key on every call (no caller-supplied filename)', () => {
    const first = tenantObjectKey(VALID_TENANT_ID, 'avatars', 'png');
    const second = tenantObjectKey(VALID_TENANT_ID, 'avatars', 'png');
    expect(first).not.toBe(second);
  });

  it('rejects a non-UUID tenantId', () => {
    expect(() => tenantObjectKey('not-a-uuid', 'avatars', 'png')).toThrow(/UUID/);
  });

  it('rejects a tenantId carrying a traversal segment', () => {
    expect(() => tenantObjectKey('../../etc/passwd', 'avatars', 'png')).toThrow(/UUID/);
  });

  it('rejects a category containing a slash', () => {
    expect(() => tenantObjectKey(VALID_TENANT_ID, 'avatars/../secrets', 'png')).toThrow();
  });

  it('rejects a category containing ".."', () => {
    expect(() => tenantObjectKey(VALID_TENANT_ID, '..', 'png')).toThrow();
  });

  it('rejects a category with uppercase or digits', () => {
    expect(() => tenantObjectKey(VALID_TENANT_ID, 'Avatars1', 'png')).toThrow();
  });

  it('rejects an unknown extension', () => {
    expect(() => tenantObjectKey(VALID_TENANT_ID, 'avatars', 'exe')).toThrow(/not allowed/);
  });

  it('rejects an extension carrying a path segment', () => {
    expect(() => tenantObjectKey(VALID_TENANT_ID, 'avatars', '../../png')).toThrow(/not allowed/);
  });

  it('accepts a mixed-case extension by normalizing it', () => {
    const key = tenantObjectKey(VALID_TENANT_ID, 'documents', 'PDF');
    expect(key).toMatch(/\.pdf$/);
  });
});
