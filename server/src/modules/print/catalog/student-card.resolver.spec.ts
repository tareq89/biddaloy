import { describe, it, expect, vi } from 'vitest';
import { FIELD_CATALOG } from '@biddaloy/shared';
import { StudentCardResolver } from './student-card.resolver';

const SCHOOL = {
  id: 't1',
  name: 'Test School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: 'tenants/t1/logo/x.png',
};

function manager(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue(rows),
    findOne: vi.fn().mockResolvedValue(SCHOOL),
  } as any;
}

describe('StudentCardResolver', () => {
  it('gives empty strings, not a crash, for a student with no enrollment or guardian', async () => {
    const m = manager([
      {
        id: 's1',
        full_name: 'Rahim',
        full_name_bn: null,
        registration_number: 'R-1',
        roll_number: null,
        blood_group: null,
        dob: null,
        photo_key: null,
        class_name: null,
        section_name: null,
        valid_until: null,
        guardian_phone: null,
      },
    ]);
    const out = await new StudentCardResolver().resolve('t1', ['s1'], m);
    const s = out.get('s1')!;
    expect(s.values['student.class']).toBe('');
    expect(s.values['guardian.phone']).toBe('');
    expect(s.values['card.valid_until']).toBe('');
    expect(s.values['student.name']).toBe('Rahim');
    expect(s.values['school.logo']).toBe('tenants/t1/logo/x.png');
    // Every catalog key is present.
    for (const f of FIELD_CATALOG.STUDENT_ID_CARD) expect(s.values).toHaveProperty(f.key);
  });

  it('issues one query for the whole batch and omits subjects not in the tenant', async () => {
    const m = manager([
      {
        id: 's1',
        full_name: 'A',
        full_name_bn: null,
        registration_number: '1',
        roll_number: 3,
        blood_group: null,
        dob: '2013-05-05',
        photo_key: 'k',
        class_name: '8',
        section_name: 'A',
        valid_until: '2027-12-31',
        guardian_phone: '017',
      },
    ]);
    const out = await new StudentCardResolver().resolve('t1', ['s1', 'other-tenant'], m);
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(out.has('other-tenant')).toBe(false);
    expect(out.get('s1')!.values['student.roll']).toBe('3');
    expect(out.get('s1')!.photoKey).toBe('k');
  });
});
