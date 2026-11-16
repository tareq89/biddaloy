import { describe, expect, it } from 'vitest';
import { AdmissionFormSchemaService } from './admission-form-schema.service';

const svc = new AdmissionFormSchemaService();

describe('AdmissionFormSchemaService', () => {
  const intake = {
    form_fields: ['father_name', 'name', 'quota_disabled', 'bogus', 'guardian_phone'],
    required_document_types: ['PHOTO', 'BIRTH_CERTIFICATE'],
  } as never;

  it('returns ticked fields in catalogue order, dropping unknown keys', () => {
    expect(svc.forRound(intake).fields.map((f) => f.key)).toEqual([
      'name',
      'father_name',
      'guardian_phone',
      'quota_disabled',
    ]);
  });

  it('keeps default required flags', () => {
    const byKey = Object.fromEntries(svc.forRound(intake).fields.map((f) => [f.key, f.required]));
    expect(byKey).toMatchObject({ name: true, father_name: true, quota_disabled: false });
  });

  it('lists the document slots', () => {
    expect(svc.forRound(intake).documents).toEqual(['PHOTO', 'BIRTH_CERTIFICATE']);
  });

  it('extraKeys leaves out the core DTO fields', () => {
    expect(svc.extraKeys(intake)).toEqual(['father_name', 'quota_disabled']);
  });
});
