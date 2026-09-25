import { describe, it, expect } from 'vitest';
import { resolveTenantSettings } from './tenant-settings-resolver';
import {
  DEFAULT_ATTENDANCE_SETTINGS,
  DEFAULT_AUTH_SETTINGS,
  DEFAULT_BACKUP_SETTINGS,
  DEFAULT_FEES_SETTINGS,
  DEFAULT_ORGANISATION_SETTINGS,
  DEFAULT_REGION_SETTINGS,
  DEFAULT_ROUTINE_SETTINGS,
} from './tenant-settings-defaults';

describe('resolveTenantSettings', () => {
  it('resolves to full defaults for a null settings blob', () => {
    const resolved = resolveTenantSettings(null);

    expect(resolved.version).toBe(1);
    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(resolved.attendance).toEqual(DEFAULT_ATTENDANCE_SETTINGS);
    expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    expect(resolved.organisation).toEqual(DEFAULT_ORGANISATION_SETTINGS);
    expect(resolved.auth).toEqual(DEFAULT_AUTH_SETTINGS);
    expect(resolved.backup).toEqual(DEFAULT_BACKUP_SETTINGS);
    expect(resolved.fees).toEqual(DEFAULT_FEES_SETTINGS);
    expect(resolved.communications).toBeUndefined();
  });

  it('resolves to full defaults for an empty settings blob', () => {
    const resolved = resolveTenantSettings({});

    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(resolved.attendance).toEqual(DEFAULT_ATTENDANCE_SETTINGS);
    expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    expect(resolved.organisation).toEqual(DEFAULT_ORGANISATION_SETTINGS);
    expect(resolved.auth).toEqual(DEFAULT_AUTH_SETTINGS);
  });

  // Regression: the resolver never returned a `routine` key at all —
  // `SchoolSettingsReader.routineSettings` reads `settings.routine!`, so
  // every routine slot save (constraint-check.ts's checkSlot) and greedy
  // fill crashed with `Cannot read properties of undefined` for every
  // tenant, on the very first save. Never caught by unit tests because
  // they stub `routineSettings: async () => ({})`.
  describe('routine (21.1.1)', () => {
    it('a stored partial override keeps unstored optional fields, not just the stored one', () => {
      const resolved = resolveTenantSettings({
        routine: { maxPeriodsPerTeacherPerDay: 4 },
      });

      expect(resolved.routine).toEqual({
        defaultChangeoverMinutes: DEFAULT_ROUTINE_SETTINGS.defaultChangeoverMinutes,
        maxPeriodsPerTeacherPerDay: 4,
      });
    });

    // [1047]: `RoutineSettingsDto` rejects these on write, but a row can
    // still get here some other way (predates the schema, hand-edited,
    // restored from a backup) — every other settings section already
    // guards against this on read; `routine` didn't.
    it('drops a malformed cap instead of passing it through', () => {
      const resolved = resolveTenantSettings({
        routine: { maxPeriodsPerTeacherPerDay: 'abc', maxConsecutivePeriods: -1 },
      });

      expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    });

    it('keeps a valid cap', () => {
      const resolved = resolveTenantSettings({
        routine: { maxConsecutivePeriods: 3 },
      });

      expect(resolved.routine).toEqual({
        defaultChangeoverMinutes: DEFAULT_ROUTINE_SETTINGS.defaultChangeoverMinutes,
        maxConsecutivePeriods: 3,
      });
    });

    it('drops a malformed subjectPeriodsPerWeek map entirely', () => {
      const resolved = resolveTenantSettings({
        routine: { subjectPeriodsPerWeek: 'not-a-map' },
      });

      expect(resolved.routine).toEqual(DEFAULT_ROUTINE_SETTINGS);
    });

    it('keeps only the numeric entries of a partially malformed subjectPeriodsPerWeek map', () => {
      const resolved = resolveTenantSettings({
        routine: { subjectPeriodsPerWeek: { math: 5, science: 'lots' } },
      });

      expect(resolved.routine).toEqual({
        defaultChangeoverMinutes: DEFAULT_ROUTINE_SETTINGS.defaultChangeoverMinutes,
        subjectPeriodsPerWeek: { math: 5 },
      });
    });
  });

  describe('organisation (33.2.1)', () => {
    it(
      'a stored shifts/versions/groups vocabulary overlays onto the empty default — ' +
        'without this, ClassService/SectionService write-validation would read `undefined`',
      () => {
        const resolved = resolveTenantSettings({
          organisation: { shifts: ['Morning', 'Day'], versions: ['Bangla'], groups: ['Science'] },
        });

        expect(resolved.organisation).toEqual({
          shifts: ['Morning', 'Day'],
          versions: ['Bangla'],
          groups: ['Science'],
        });
      },
    );
  });

  describe('backup.schedule (14.12.1/#615)', () => {
    it('stored {} resolves to the default WEEKLY', () => {
      expect(resolveTenantSettings({}).backup?.schedule).toBe('WEEKLY');
    });

    it('a stored OFF overrides the default', () => {
      expect(resolveTenantSettings({ backup: { schedule: 'OFF' } }).backup?.schedule).toBe('OFF');
    });

    it('a stored DAILY overrides the default', () => {
      expect(resolveTenantSettings({ backup: { schedule: 'DAILY' } }).backup?.schedule).toBe(
        'DAILY',
      );
    });

    it(
      'a same-typed but invalid stored value falls back to the default — `overlayOnDefaults` ' +
        'only type-checks, so this is the read-side guard for a row that bypassed ' +
        "BackupSettingsDto's @IsIn on write",
      () => {
        expect(resolveTenantSettings({ backup: { schedule: 'NONSENSE' } }).backup?.schedule).toBe(
          DEFAULT_BACKUP_SETTINGS.schedule,
        );
      },
    );
  });

  describe('fees.approvalMode (16.2.1)', () => {
    it('stored {} resolves to the default OTP', () => {
      expect(resolveTenantSettings({}).fees?.approvalMode).toBe('OTP');
    });

    it('a stored OTP_OR_PASSWORD overrides the default', () => {
      expect(
        resolveTenantSettings({ fees: { approvalMode: 'OTP_OR_PASSWORD' } }).fees?.approvalMode,
      ).toBe('OTP_OR_PASSWORD');
    });

    it(
      'a same-typed but invalid stored value falls back to the default — the read-side guard ' +
        "for a row that bypassed FeesSettingsDto's @IsIn on write",
      () => {
        expect(
          resolveTenantSettings({ fees: { approvalMode: 'NONSENSE' } }).fees?.approvalMode,
        ).toBe(DEFAULT_FEES_SETTINGS.approvalMode);
      },
    );

    it('notifyOnManualGenerationDefault/notifyOnScheduleDefault default false/true and can be overridden', () => {
      expect(resolveTenantSettings({}).fees?.notifyOnManualGenerationDefault).toBe(false);
      expect(resolveTenantSettings({}).fees?.notifyOnScheduleDefault).toBe(true);
      expect(
        resolveTenantSettings({ fees: { notifyOnManualGenerationDefault: true } }).fees
          ?.notifyOnManualGenerationDefault,
      ).toBe(true);
      expect(
        resolveTenantSettings({ fees: { notifyOnScheduleDefault: false } }).fees
          ?.notifyOnScheduleDefault,
      ).toBe(false);
    });
  });

  it('a school unset returns the default otpLoginEnabled=true, and a stored false overrides it', () => {
    expect(resolveTenantSettings(null).auth?.otpLoginEnabled).toBe(true);
    expect(resolveTenantSettings({ auth: { otpLoginEnabled: false } }).auth?.otpLoginEnabled).toBe(
      false,
    );
  });

  it('merges a partial attendance patch over defaults, keeping the rest', () => {
    const resolved = resolveTenantSettings({ attendance: { lateAfter: '09:00' } });

    expect(resolved.attendance).toEqual({ ...DEFAULT_ATTENDANCE_SETTINGS, lateAfter: '09:00' });
  });

  it('falls back to default region when only communications is configured', () => {
    const resolved = resolveTenantSettings({
      communications: { whatsapp: { phoneNumberId: '123', accessToken: 'enc:abc' } },
    });

    expect(resolved.region).toEqual(DEFAULT_REGION_SETTINGS);
    expect(resolved.communications).toEqual({
      whatsapp: { phoneNumberId: '123', accessToken: 'enc:abc' },
    });
  });

  it('keeps a stored region rather than falling back when one is present', () => {
    const customRegion = { ...DEFAULT_REGION_SETTINGS, locale: 'en-BD', timezone: 'Asia/Dhaka' };

    const resolved = resolveTenantSettings({ region: customRegion });

    expect(resolved.region).toEqual(customRegion);
    expect(resolved.communications).toBeUndefined();
  });

  it('always stamps the current schema version regardless of what was stored', () => {
    const resolved = resolveTenantSettings({ version: 999 });

    expect(resolved.version).toBe(1);
  });

  // The stored blob isn't re-validated on read — it can predate a schema
  // change, be hand-edited, or come back from a backup — so a section
  // being present doesn't make it complete. Callers rely on every region
  // field existing; resolving per-section rather than per-field would
  // hand them a region missing `currency`, `date`, and the rest.
  describe('partial and malformed stored regions', () => {
    it('fills in every field a partially-stored region omits', () => {
      const resolved = resolveTenantSettings({ region: { locale: 'en-BD' } });

      expect(resolved.region).toEqual({ ...DEFAULT_REGION_SETTINGS, locale: 'en-BD' });
    });

    it('merges inside a nested group, not just at the top level', () => {
      const resolved = resolveTenantSettings({ region: { currency: { code: 'USD' } } });

      expect(resolved.region?.currency).toEqual({
        ...DEFAULT_REGION_SETTINGS.currency,
        code: 'USD',
      });
      expect(resolved.region?.date).toEqual(DEFAULT_REGION_SETTINGS.date);
    });

    it('falls back per field on a wrong-typed value, keeping its siblings', () => {
      const resolved = resolveTenantSettings({
        region: { locale: 42, timezone: 'Asia/Dhaka' },
      });

      expect(resolved.region?.locale).toBe(DEFAULT_REGION_SETTINGS.locale);
      expect(resolved.region?.timezone).toBe('Asia/Dhaka');
    });

    it('falls back to the default group when a nested group is not an object', () => {
      const resolved = resolveTenantSettings({ region: { currency: null, date: 'nonsense' } });

      expect(resolved.region?.currency).toEqual(DEFAULT_REGION_SETTINGS.currency);
      expect(resolved.region?.date).toEqual(DEFAULT_REGION_SETTINGS.date);
    });

    it('replaces an array wholesale rather than merging it element-wise', () => {
      const resolved = resolveTenantSettings({
        region: { address: { fields: ['street'], order: ['street'] } },
      });

      expect(resolved.region?.address).toEqual({ fields: ['street'], order: ['street'] });
    });

    it('drops a stored key the current schema no longer knows about', () => {
      const resolved = resolveTenantSettings({ region: { locale: 'en-BD', legacyField: 'x' } });

      expect(resolved.region).not.toHaveProperty('legacyField');
    });

    it('falls back to defaults when region itself is not an object', () => {
      expect(resolveTenantSettings({ region: 'nonsense' }).region).toEqual(DEFAULT_REGION_SETTINGS);
      expect(resolveTenantSettings({ region: null }).region).toEqual(DEFAULT_REGION_SETTINGS);
    });

    it('omits communications when it is stored as something other than an object', () => {
      expect(resolveTenantSettings({ communications: 'nonsense' }).communications).toBeUndefined();
    });
  });
});
