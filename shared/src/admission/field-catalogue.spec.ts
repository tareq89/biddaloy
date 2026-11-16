import { describe, expect, it } from 'vitest';
import { AdmissionTemplateKey } from '../enums/admission';
import {
  ADMISSION_FIELD_CATALOGUE as C,
  fieldsForRound,
  UNKNOWN_FIELD_ERROR_KEY,
  validateExtraFields,
} from './field-catalogue';
import { ADMISSION_TEMPLATES } from './templates';

describe('admission field catalogue', () => {
  it('has unique keys and bn + en labels', () => {
    expect(new Set(C.map((d) => d.key)).size).toBe(C.length);
    for (const d of C) {
      expect(d.label.bn, d.key).not.toBe('');
      expect(d.label.en, d.key).not.toBe('');
      expect(d.help).toBe(`help.admission.field.${d.key}`);
    }
  });

  it('fieldsForRound drops unknown keys', () => {
    expect(fieldsForRound(['dob', 'nope']).map((d) => d.key)).toEqual(['dob']);
  });

  it('accepts a good map', () => {
    const keys = ['name', 'dob', 'gender', 'guardian_phone', 'quota_disabled'];
    const ok = {
      name: 'Rahim',
      dob: '2014-05-05',
      gender: 'MALE',
      guardian_phone: '01711000000',
      quota_disabled: false,
    };
    expect(validateExtraFields(keys, ok)).toEqual({});
  });

  it('rejects a missing required field, and honours an override', () => {
    expect(validateExtraFields(['name'], {})).toEqual({ name: 'REQUIRED' });
    expect(validateExtraFields(['name'], {}, { name: false })).toEqual({});
    expect(validateExtraFields(['transport_need'], {}, { transport_need: true })).toEqual({
      transport_need: 'REQUIRED',
    });
  });

  it('rejects an unknown or un-ticked key', () => {
    expect(validateExtraFields(['name'], { name: 'A', bogus: 'x' })).toEqual({
      [UNKNOWN_FIELD_ERROR_KEY]: 'UNKNOWN_FIELD',
    });
    expect(validateExtraFields(['name'], { name: 'A', dob: '2014-01-01' })).toEqual({
      [UNKNOWN_FIELD_ERROR_KEY]: 'UNKNOWN_FIELD',
    });
  });

  it('rejects malformed values and never echoes them (Rule 23)', () => {
    const secret = 'SECRET-VALUE-9';
    const errs = validateExtraFields(['dob', 'gender', 'guardian_phone', 'ssc_year'], {
      dob: secret,
      gender: secret,
      guardian_phone: secret,
      ssc_year: secret,
      [secret]: secret,
    });
    expect(errs).toMatchObject({
      dob: 'INVALID',
      gender: 'INVALID',
      guardian_phone: 'INVALID',
      ssc_year: 'INVALID',
    });
    expect(JSON.stringify(errs)).not.toContain(secret);
  });
});

describe('admission templates', () => {
  it('cover every template key with only catalogue fields and at least one stage', () => {
    const keys = new Set(C.map((d) => d.key));
    for (const k of Object.values(AdmissionTemplateKey)) {
      const t = ADMISSION_TEMPLATES[k];
      expect(t.stages.length, k).toBeGreaterThan(0);
      for (const f of t.fields) expect(keys.has(f), `${k}:${f}`).toBe(true);
    }
  });
});
