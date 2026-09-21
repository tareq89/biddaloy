import { describe, it, expect } from 'vitest';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import { DEFAULT_ORGANISATION_SETTINGS, DEFAULT_TENANT_SETTINGS } from './tenant-settings-defaults';

describe('DEFAULT_ORGANISATION_SETTINGS', () => {
  it('defaults every list to empty — a school opts in, nothing is invented', () => {
    expect(DEFAULT_ORGANISATION_SETTINGS).toEqual({
      shifts: [],
      versions: [],
      groups: [],
    });
  });
});

describe('DEFAULT_TENANT_SETTINGS', () => {
  it('includes the organisation defaults', () => {
    expect(DEFAULT_TENANT_SETTINGS.organisation).toBe(DEFAULT_ORGANISATION_SETTINGS);
  });

  it('carries the current schema version', () => {
    expect(DEFAULT_TENANT_SETTINGS.version).toBe(TENANT_SETTINGS_SCHEMA_VERSION);
  });
});
