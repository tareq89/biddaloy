import { describe, it, expect } from 'vitest';
import { buildDatabaseSsl } from './db-ssl';

describe('buildDatabaseSsl', () => {
  it('refuses to build config when NODE_ENV=production and DB_SSL is not set', () => {
    expect(() => buildDatabaseSsl('production', undefined, undefined)).toThrow(
      /DB_SSL must be "true"/,
    );
  });

  it('refuses to build config when NODE_ENV=production and DB_SSL is not exactly "true"', () => {
    expect(() => buildDatabaseSsl('production', 'yes', undefined)).toThrow(/DB_SSL must be "true"/);
  });

  it('returns ssl: false outside production when DB_SSL is unset', () => {
    expect(buildDatabaseSsl('development', undefined, undefined)).toEqual({ ssl: false });
    expect(buildDatabaseSsl('test', undefined, undefined)).toEqual({ ssl: false });
    expect(buildDatabaseSsl(undefined, undefined, undefined)).toEqual({ ssl: false });
  });

  it('enables ssl with certificate verification on by default when DB_SSL=true', () => {
    const result = buildDatabaseSsl('production', 'true', undefined);
    expect(result.ssl).toEqual({ rejectUnauthorized: true });
    expect(result.warning).toBeUndefined();
  });

  it('lets DB_SSL=true be opted into outside production too', () => {
    const result = buildDatabaseSsl('development', 'true', undefined);
    expect(result.ssl).toEqual({ rejectUnauthorized: true });
  });

  it('disables certificate verification, with a warning, when explicitly requested', () => {
    const result = buildDatabaseSsl('production', 'true', 'false');
    expect(result.ssl).toEqual({ rejectUnauthorized: false });
    expect(result.warning).toMatch(/disables Postgres certificate verification/);
  });

  it('treats anything other than the literal string "false" as verification enabled', () => {
    const result = buildDatabaseSsl('production', 'true', 'no');
    expect(result.ssl).toEqual({ rejectUnauthorized: true });
  });
});
