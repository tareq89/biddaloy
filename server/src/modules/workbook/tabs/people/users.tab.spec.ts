import { describe, expect, it } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { User } from '../../../users/entities/user.entity';
import { UserTenant } from '../../../auth/entities/user-tenant.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext } from '../../codec/tab-spec';
import { schoolTab } from '../school/school.tab';
import { pickRole, usersTab, type UserRow } from './users.tab';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const exportCtx: ExportContext = { keyOf: () => '' };
const importCtx: ImportContext = {
  tenantId: TENANT_ID,
  ref: () => undefined,
  warn: () => undefined,
};

function makeMembership(overrides: Partial<UserTenant> = {}): UserTenant {
  return Object.assign(new UserTenant(), {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_id: USER_ID,
    tenant_id: TENANT_ID,
    role: UserRole.ADMIN,
    metadata: null,
    ...overrides,
  } satisfies Partial<UserTenant>);
}

function makeUser(overrides: Partial<User> = {}, memberships?: UserTenant[]): User {
  return Object.assign(new User(), {
    id: USER_ID,
    email: 'admin@dhaka-model.test',
    phone: '01712345678',
    full_name: 'Rahim Uddin',
    user_tenants: memberships ?? [makeMembership()],
    ...overrides,
  } satisfies Partial<User>);
}

/**
 * Real pipeline, both directions: `toRow` then `toCell` on the way out, then
 * `cellText` on the way back in, mirroring `school.tab.spec.ts`.
 */
function toCells(user: User): Record<string, string> {
  const row = usersTab.toRow(user, exportCtx);
  const cells: Record<string, string> = {};
  for (const column of usersTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

describe('usersTab shape', () => {
  it('is registered through the people barrel', () => {
    // Relaxed from `toEqual([usersTab])`: `teachers`, `teacher_assignments`
    // and `guardians` have since landed in the same barrel. Assert `users`
    // is present and first, not that it's the only tab (matches the
    // `toContain` + index style in `teachers.tab.spec.ts`).
    expect(peopleTabs).toContain(usersTab);
    expect(peopleTabs[0]).toBe(usersTab);
  });

  it('satisfies the registry contract', () => {
    expect(() => assertRegistryValid([schoolTab, usersTab], { partial: true })).not.toThrow();
  });

  it('declares its dependency and identity shape', () => {
    expect(usersTab.name).toBe('users');
    expect(usersTab.dependsOn).toEqual(['school']);
    expect(usersTab.naturalKey).toEqual(['email']);
    expect(usersTab.deleteByAbsence).toBe(true);
    expect(usersTab.columns[0]).toEqual({
      key: 'id',
      type: 'uuid',
      required: true,
      label: { en: 'ID', bn: 'আইডি' },
    });
  });

  it('excludes exactly the un-exported User columns', () => {
    expect(usersTab.excluded).toEqual(
      expect.arrayContaining([
        'password_hash',
        'email_verified_at',
        'phone_verified_at',
        'status',
        'profile_picture_url',
        'preferences',
        'last_login_at',
      ]),
    );
    expect(usersTab.excluded).toHaveLength(7);

    const exported = usersTab.columns.map((c) => c.key);
    for (const key of usersTab.excluded) {
      expect(exported).not.toContain(key);
    }
  });
});

describe('keyOf', () => {
  it('returns the email for a UserRow, never a uuid', () => {
    const key = usersTab.keyOf(makeUser());
    expect(key).toBe('admin@dhaka-model.test');
    expect(key).not.toMatch(UUID_RE);
  });

  it('falls back to phone when email is empty', () => {
    expect(usersTab.keyOf(makeUser({ email: null }))).toBe('01712345678');
  });

  it('returns the same key shape for a UserRow as for a User', () => {
    const user = makeUser();
    const row: UserRow = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      full_name: user.full_name,
      role: UserRole.ADMIN,
    };
    expect(usersTab.keyOf(row)).toBe(usersTab.keyOf(user));
  });
});

describe('pickRole', () => {
  it('picks by declaration precedence when a user holds two roles', () => {
    const memberships = [
      makeMembership({ role: UserRole.TEACHER }),
      makeMembership({ role: UserRole.ADMIN }),
    ];
    expect(pickRole(memberships)).toBe(UserRole.ADMIN);
  });

  it('throws when there are no memberships', () => {
    expect(() => pickRole([])).toThrow();
  });
});

describe('round trip', () => {
  it('round-trips every field for an ADMIN with both email and phone', () => {
    const user = makeUser();

    const result = usersTab.fromRow(toCells(user), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: USER_ID,
        email: 'admin@dhaka-model.test',
        phone: '01712345678',
        full_name: 'Rahim Uddin',
        role: UserRole.ADMIN,
      } satisfies UserRow,
    });
  });

  it('round-trips with phone null', () => {
    const user = makeUser({ phone: null });

    const result = usersTab.fromRow(toCells(user), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: USER_ID,
        email: 'admin@dhaka-model.test',
        phone: null,
        full_name: 'Rahim Uddin',
        role: UserRole.ADMIN,
      } satisfies UserRow,
    });
  });

  it('round-trips with email null, and keyOf then returns the phone', () => {
    const user = makeUser({ email: null });

    const result = usersTab.fromRow(toCells(user), 2, importCtx);

    expect(result).toEqual({
      row: {
        id: USER_ID,
        email: null,
        phone: '01712345678',
        full_name: 'Rahim Uddin',
        role: UserRole.ADMIN,
      } satisfies UserRow,
    });
    if ('row' in result) {
      expect(usersTab.keyOf(result.row)).toBe('01712345678');
    }
  });

  it('picks the documented role when a user holds two memberships (TEACHER + ADMIN -> ADMIN)', () => {
    const user = makeUser({}, [
      makeMembership({ role: UserRole.TEACHER }),
      makeMembership({ role: UserRole.ADMIN }),
    ]);

    const result = usersTab.fromRow(toCells(user), 2, importCtx);

    expect(result).toEqual({
      row: expect.objectContaining({ role: UserRole.ADMIN }),
    });
  });
});

describe('fromRow validation', () => {
  it('rejects role = SUPER_ADMIN naming the role column', () => {
    const cells = { ...toCells(makeUser()), role: 'SUPER_ADMIN' };

    const result = usersTab.fromRow(cells, 3, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('role');
    expect(result.errors[0].message).toContain('SUPER_ADMIN');
  });

  it('rejects a row with neither email nor phone as a row-level error', () => {
    const cells = { ...toCells(makeUser()), email: '', phone: '' };

    const result = usersTab.fromRow(cells, 3, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBeNull();
    expect(result.errors[0].message).toContain('email or a phone number');
  });

  it('rejects a full_name longer than 100 characters', () => {
    const cells = { ...toCells(makeUser()), full_name: 'a'.repeat(101) };

    const result = usersTab.fromRow(cells, 3, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('full_name');
    expect(result.errors[0].message).toContain('100 characters');
  });

  it('rejects an over-long email', () => {
    const cells = { ...toCells(makeUser()), email: `${'a'.repeat(96)}@x.co` };

    const result = usersTab.fromRow(cells, 3, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('email');
  });

  it('rejects an over-long phone', () => {
    const cells = { ...toCells(makeUser()), phone: '0'.repeat(21) };

    const result = usersTab.fromRow(cells, 3, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('phone');
  });

  it('rejects an empty full_name (required)', () => {
    const cells = { ...toCells(makeUser()), full_name: '' };

    const result = usersTab.fromRow(cells, 3, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('full_name');
  });

  it('rejects a non-v4 id', () => {
    const cells = { ...toCells(makeUser()), id: 'not-a-uuid' };

    const result = usersTab.fromRow(cells, 3, importCtx);

    expect('errors' in result).toBe(true);
    if (!('errors' in result)) return;
    expect(result.errors[0].column).toBe('id');
  });
});

describe('diffFields', () => {
  it('reports no changes when nothing differs', () => {
    const user = makeUser();
    const row = usersTab.fromRow(toCells(user), 2, importCtx);
    if ('errors' in row) throw new Error('fixture should parse');

    expect(usersTab.diffFields(row.row, user)).toEqual([]);
  });

  it('names the changed field', () => {
    const user = makeUser();
    const row = usersTab.fromRow(toCells(user), 2, importCtx);
    if ('errors' in row) throw new Error('fixture should parse');

    expect(usersTab.diffFields({ ...row.row, full_name: 'Karim Uddin' }, user)).toEqual([
      'full_name',
    ]);
  });
});
