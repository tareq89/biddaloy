import { describe, it, expect } from 'vitest';
import { TENANT_SETTINGS_SCHEMA_VERSION } from '../dto/tenant-settings.dto';
import {
  DEFAULT_ORGANISATION_SETTINGS,
  DEFAULT_ROUTINE_SETTINGS,
  DEFAULT_STUDY_PLANS_SETTINGS,
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

describe('DEFAULT_STUDY_PLANS_SETTINGS', () => {
  it('matches D25/D26', () => {
    expect(DEFAULT_STUDY_PLANS_SETTINGS).toEqual({
      statusDeadline: '18:00',
      reminderTime: '08:00',
      escalateAfterSchoolDays: 2,
      weeklyDigestTime: '17:00',
      guardianDigestSms: false,
    });
    expect(DEFAULT_TENANT_SETTINGS.studyPlans).toBe(DEFAULT_STUDY_PLANS_SETTINGS);
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
