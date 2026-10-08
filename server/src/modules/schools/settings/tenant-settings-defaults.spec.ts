import { describe, it, expect } from 'vitest';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import {
  DEFAULT_DOCUMENTS_SETTINGS,
  DEFAULT_ORGANISATION_SETTINGS,
  DEFAULT_ROUTINE_SETTINGS,
  DEFAULT_TENANT_SETTINGS,
} from './tenant-settings-defaults';

describe('DEFAULT_ORGANISATION_SETTINGS', () => {
  it('defaults every list to empty — a school opts in, nothing is invented', () => {
    expect(DEFAULT_ORGANISATION_SETTINGS).toEqual({
      shifts: [],
      versions: [],
      groups: [],
    });
  });
});

describe('DEFAULT_ROUTINE_SETTINGS', () => {
  it('defaults to a 5-minute changeover with no caps set', () => {
    expect(DEFAULT_ROUTINE_SETTINGS).toEqual({
      defaultChangeoverMinutes: 5,
    });
  });
});

describe('DEFAULT_DOCUMENTS_SETTINGS', () => {
  it('never withholds the admit card by default, and is part of DEFAULT_TENANT_SETTINGS (48.1.03)', () => {
    expect(DEFAULT_DOCUMENTS_SETTINGS).toEqual({ withholdAdmitCardForDues: false });
    expect(DEFAULT_TENANT_SETTINGS.documents).toBe(DEFAULT_DOCUMENTS_SETTINGS);
  });
});

describe('DEFAULT_TENANT_SETTINGS', () => {
  it('has no default preset (absent until applied)', () => {
    expect(DEFAULT_TENANT_SETTINGS.preset).toBeUndefined();
  });

  it('includes the organisation defaults', () => {
    expect(DEFAULT_TENANT_SETTINGS.organisation).toBe(DEFAULT_ORGANISATION_SETTINGS);
  });

  it('includes the routine defaults', () => {
    expect(DEFAULT_TENANT_SETTINGS.routine).toBe(DEFAULT_ROUTINE_SETTINGS);
  });

  it('carries the current schema version', () => {
    expect(DEFAULT_TENANT_SETTINGS.version).toBe(TENANT_SETTINGS_SCHEMA_VERSION);
  });
});
