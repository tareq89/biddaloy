import { describe, it, expect, vi } from 'vitest';
import { FIELD_CATALOG, UserRole } from '@biddaloy/shared';
import { STAFF_CARD_ROLES, StaffCardResolver } from './staff-card.resolver';

const SCHOOL = {
  id: 't1',
  name: 'Test School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: null,
};

function manager(rows: unknown[]) {
  return {
    query: vi.fn().mockResolvedValue(rows),
    findOne: vi.fn().mockResolvedValue(SCHOOL),
  } as any;
}

describe('StaffCardResolver', () => {
  it('gives an empty name_bn for staff with no HR record', async () => {
    const m = manager([
      {
        id: 'u1',
        full_name: 'Fatema',
        phone: null,
        name_bn: null,
        blood_group: null,
        designation: null,
        employee_id: null,
        photo_key: null,
      },
    ]);
    const s = (await new StaffCardResolver().resolve('t1', ['u1'], m)).get('u1')!;
    expect(s.values['staff.name_bn']).toBe('');
    expect(s.values['staff.designation']).toBe('');
    for (const f of FIELD_CATALOG.STAFF_ID_CARD) expect(s.values).toHaveProperty(f.key);
  });

  it('issues one query for the whole batch', async () => {
    const m = manager([
      {
        id: 'u1',
        full_name: 'A',
        phone: '019',
        name_bn: 'ক',
        blood_group: 'O+',
        designation: 'Teacher',
        employee_id: 'E1',
        photo_key: 'tenants/t1/staff-documents/p.jpg',
      },
      {
        id: 'u2',
        full_name: 'B',
        phone: null,
        name_bn: null,
        blood_group: null,
        designation: null,
        employee_id: null,
        photo_key: null,
      },
    ]);
    const out = await new StaffCardResolver().resolve('t1', ['u1', 'u2'], m);
    expect(m.query).toHaveBeenCalledTimes(1);
    expect(out.get('u1')!.values['staff.employee_id']).toBe('E1');
    expect(out.get('u1')!.photoKey).toContain('p.jpg');
  });

  it('resolves the new employee roles but never COMMITTEE (#1379 F4)', async () => {
    const m = manager([]);
    await new StaffCardResolver().resolve('t1', ['u1'], m);
    const roles = m.query.mock.calls[0][1][2];
    expect(roles).toBe(STAFF_CARD_ROLES);
    expect(roles).toEqual(
      expect.arrayContaining([UserRole.OFFICE_STAFF, UserRole.EXAM_CONTROLLER]),
    );
    expect(roles).not.toContain(UserRole.COMMITTEE);
  });
});
