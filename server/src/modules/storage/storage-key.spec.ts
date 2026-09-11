import { describe, expect, it } from 'vitest';
import { tenantObjectKey, tenantObjectKeyNamed } from './storage-key';

const VALID_TENANT_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

describe('tenantObjectKey', () => {
  it('builds a tenants/<uuid>/<category>/<uuid>.<ext> key', () => {
    const key = tenantObjectKey(VALID_TENANT_ID, 'avatars', 'png');
    expect(key).toMatch(new RegExp(`^tenants/${VALID_TENANT_ID}/avatars/[0-9a-f-]{36}\\.png$`));
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

describe('tenantObjectKeyNamed', () => {
  const TENANT = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  const NAME = '9b1d4c62-4e3a-4f7b-8a21-6c5e0f3d7a10';

  it('is stable across calls, so a retried write overwrites its own object', () => {
    expect(tenantObjectKeyNamed(TENANT, 'backups', NAME, 'xlsx')).toBe(
      tenantObjectKeyNamed(TENANT, 'backups', NAME, 'xlsx'),
    );
  });

  it('puts the supplied name in the filename slot, keeping the tenant prefix', () => {
    expect(tenantObjectKeyNamed(TENANT, 'backups', NAME, 'xlsx')).toBe(
      `tenants/${TENANT}/backups/${NAME}.xlsx`,
    );
  });

  it('rejects a non-UUID name, so no caller can supply a path', () => {
    expect(() => tenantObjectKeyNamed(TENANT, 'backups', '../../etc/passwd', 'xlsx')).toThrow(
      /must be a UUID/,
    );
    expect(() => tenantObjectKeyNamed(TENANT, 'backups', 'job-1', 'xlsx')).toThrow(
      /must be a UUID/,
    );
  });

  it('still enforces the tenant, category and extension rules', () => {
    expect(() => tenantObjectKeyNamed('not-a-uuid', 'backups', NAME, 'xlsx')).toThrow();
    expect(() => tenantObjectKeyNamed(TENANT, 'bad/category', NAME, 'xlsx')).toThrow();
    expect(() => tenantObjectKeyNamed(TENANT, 'backups', NAME, 'exe')).toThrow();
  });
});
