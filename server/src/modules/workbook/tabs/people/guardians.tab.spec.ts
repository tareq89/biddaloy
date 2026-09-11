import { describe, expect, it, vi } from 'vitest';
import { CommunicationMedium } from '@biddaloy/shared';
import { Guardian } from '../../../students/entities/guardian.entity';
import { cellText, toCell } from '../../codec/cell-format';
import { assertRegistryValid } from '../../codec/registry';
import type { ExportContext, ImportContext, RowError } from '../../codec/tab-spec';
import { schoolTab } from '../school/school.tab';
import { usersTab } from './users.tab';
import { teachersTab } from './teachers.tab';
import { teacherAssignmentsTab } from './teacher-assignments.tab';
import { guardiansTab, type GuardianRow } from './guardians.tab';
import { peopleTabs } from './index';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const GUARDIAN_ID = '7f3e4b2a-1c5d-4e8f-9a6b-2d1c3e4f5a6b';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const usersByEmail: Record<string, string> = { 'guardian@dhaka-model.test': USER_ID };

function exportCtx(): ExportContext {
  return {
    keyOf: (_tab: string, id: string) => (id === USER_ID ? 'guardian@dhaka-model.test' : ''),
  };
}

function importCtx(): ImportContext & { warn: ReturnType<typeof vi.fn> } {
  return {
    tenantId: TENANT_ID,
    ref: (_tab: string, key: string) => usersByEmail[key],
    warn: vi.fn<(e: RowError) => void>(),
  };
}

function makeGuardian(overrides: Partial<Guardian> = {}): Guardian {
  return Object.assign(new Guardian(), {
    id: GUARDIAN_ID,
    user_id: USER_ID,
    full_name: 'Karim Uddin',
    relationship: 'Father',
    phone: '01712345678',
    email: 'guardian@dhaka-model.test',
    alternate_phone: '01812345678',
    address: 'House 5, Road 2, Dhaka',
    occupation: 'Engineer',
    preferred_communication: CommunicationMedium.SMS,
    is_primary_contact: true,
    notifications_enabled: true,
    tenant_id: TENANT_ID,
    ...overrides,
  } satisfies Partial<Guardian>);
}

/** Real pipeline, both directions, mirroring `teachers.tab.spec.ts`. */
function toCells(guardian: Guardian): Record<string, string> {
  const row = guardiansTab.toRow(guardian, exportCtx());
  const cells: Record<string, string> = {};
  for (const column of guardiansTab.columns) {
    const cell = toCell(column.type, row[column.key]);
    cells[column.key] = cellText(cell === null ? '' : String(cell));
  }
  return cells;
}

function fromRowOrThrow(
  cells: Record<string, string>,
  ctx: ImportContext = importCtx(),
): GuardianRow {
  const result = guardiansTab.fromRow(cells, 2, ctx);
  if ('errors' in result) {
    throw new Error(`Unexpected errors: ${JSON.stringify(result.errors)}`);
  }
  return result.row;
}

describe('guardiansTab shape', () => {
  it('is registered through the people barrel, after users', () => {
    expect(peopleTabs).toContain(guardiansTab);
    expect(peopleTabs.indexOf(usersTab)).toBeLessThan(peopleTabs.indexOf(guardiansTab));
  });

  it('satisfies the registry contract', () => {
    expect(() =>
      assertRegistryValid([schoolTab, usersTab, teachersTab, teacherAssignmentsTab, guardiansTab], {
        partial: true,
      }),
    ).not.toThrow();
  });

  it('declares its dependency and identity shape', () => {
    expect(guardiansTab.name).toBe('guardians');
    expect(guardiansTab.dependsOn).toEqual(['users']);
    expect(guardiansTab.naturalKey).toEqual(['phone']);
    expect(guardiansTab.deleteByAbsence).toBe(true);
    expect(guardiansTab.columns[0]).toEqual({
      key: 'id',
      type: 'uuid',
      required: true,
      label: { en: 'ID', bn: 'আইডি' },
    });
  });

  it('excludes exactly user_id', () => {
    expect(guardiansTab.excluded).toEqual(['user_id']);
    const exported = guardiansTab.columns.map((c) => c.key);
    expect(exported).not.toContain('user_id');
  });
});

describe('keyOf', () => {
  it('uses phone when present', () => {
    const guardian = makeGuardian();
    expect(guardiansTab.keyOf(guardian)).toBe('01712345678');
  });

  it('falls back to email when phone is absent', () => {
    const guardian = makeGuardian({ phone: null });
    expect(guardiansTab.keyOf(guardian)).toBe('guardian@dhaka-model.test');
  });

  it('falls back to full_name|relationship when both phone and email are absent', () => {
    const guardian = makeGuardian({ phone: null, email: null });
    expect(guardiansTab.keyOf(guardian)).toBe('Karim Uddin|Father');
  });

  it('returns the same key shape for a GuardianRow as for a Guardian', () => {
    const guardian = makeGuardian();
    const cells = toCells(guardian);
    const row = fromRowOrThrow(cells);
    expect(guardiansTab.keyOf(row)).toBe(guardiansTab.keyOf(guardian));
  });
});

describe('round-trip', () => {
  it('fromRow(toRow(entity)) round-trips every field for a fully populated guardian', () => {
    const guardian = makeGuardian();
    const cells = toCells(guardian);
    const row = fromRowOrThrow(cells);

    expect(row).toEqual({
      id: guardian.id,
      user_id: USER_ID,
      full_name: 'Karim Uddin',
      relationship: 'Father',
      phone: '01712345678',
      email: 'guardian@dhaka-model.test',
      alternate_phone: '01812345678',
      address: 'House 5, Road 2, Dhaka',
      occupation: 'Engineer',
      preferred_communication: CommunicationMedium.SMS,
      is_primary_contact: true,
      notifications_enabled: true,
      user_key: 'guardian@dhaka-model.test',
    } satisfies GuardianRow);
  });

  it('fromRow(toRow(entity)) round-trips a minimal guardian (no phone, no email, no user)', () => {
    const guardian = makeGuardian({
      user_id: null,
      phone: null,
      email: null,
      alternate_phone: null,
      address: null,
      occupation: null,
    });
    const ctx = importCtx();
    const cells = toCells(guardian);
    const row = fromRowOrThrow(cells, ctx);

    expect(row).toEqual({
      id: guardian.id,
      user_id: null,
      full_name: 'Karim Uddin',
      relationship: 'Father',
      phone: null,
      email: null,
      alternate_phone: null,
      address: null,
      occupation: null,
      preferred_communication: CommunicationMedium.SMS,
      is_primary_contact: true,
      notifications_enabled: true,
      user_key: null,
    } satisfies GuardianRow);
    // Weak-key warning fires because phone is empty.
    expect(ctx.warn).toHaveBeenCalledTimes(1);
  });

  it('toRow writes `user` as the users natural key, not null, when user_id is set', () => {
    const guardian = makeGuardian();
    const cells = toCells(guardian);
    expect(cells.user).toBe('guardian@dhaka-model.test');
  });

  it('toRow writes an empty `user` cell when user_id is null', () => {
    const guardian = makeGuardian({ user_id: null });
    const cells = toCells(guardian);
    expect(cells.user).toBe('');
  });
});

describe('fromRow weak-key warning', () => {
  it('emits exactly one warning through ctx.warn when phone is empty', () => {
    const guardian = makeGuardian({ phone: null });
    const ctx = importCtx();
    const cells = toCells(guardian);

    const result = guardiansTab.fromRow(cells, 3, ctx);

    expect('row' in result).toBe(true);
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    const warning = ctx.warn.mock.calls[0][0] as RowError;
    expect(warning.severity).toBe('warning');
    expect(warning.column).toBe('phone');
  });

  it('emits no warning when phone is set', () => {
    const guardian = makeGuardian();
    const ctx = importCtx();
    const cells = toCells(guardian);

    guardiansTab.fromRow(cells, 3, ctx);

    expect(ctx.warn).not.toHaveBeenCalled();
  });
});

describe('fromRow validation', () => {
  it('an unresolvable user key yields a RowError on column user', () => {
    const guardian = makeGuardian();
    const cells = toCells(guardian);
    cells.user = 'ghost@nowhere.test';

    const result = guardiansTab.fromRow(cells, 4, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].column).toBe('user');
  });

  it('an empty required full_name yields a RowError', () => {
    const guardian = makeGuardian();
    const cells = toCells(guardian);
    cells.full_name = '';

    const result = guardiansTab.fromRow(cells, 5, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors.some((e) => e.column === 'full_name')).toBe(true);
  });

  it('a preferred_communication value outside the enum yields a RowError', () => {
    const guardian = makeGuardian();
    const cells = toCells(guardian);
    cells.preferred_communication = 'CARRIER_PIGEON';

    const result = guardiansTab.fromRow(cells, 6, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors.some((e) => e.column === 'preferred_communication')).toBe(true);
  });

  it('a 101-character full_name yields the max-length error', () => {
    const guardian = makeGuardian();
    const cells = toCells(guardian);
    cells.full_name = 'A'.repeat(101);

    const result = guardiansTab.fromRow(cells, 7, importCtx());
    expect('errors' in result).toBe(true);
    const errors = (result as { errors: RowError[] }).errors;
    expect(errors.some((e) => e.column === 'full_name' && e.message.includes('100'))).toBe(true);
  });
});

describe('fromRow defaults', () => {
  it('empty preferred_communication/is_primary_contact/notifications_enabled cells default to SMS/true/true', () => {
    const guardian = makeGuardian();
    const cells = toCells(guardian);
    cells.preferred_communication = '';
    cells.is_primary_contact = '';
    cells.notifications_enabled = '';

    const row = fromRowOrThrow(cells);
    expect(row.preferred_communication).toBe(CommunicationMedium.SMS);
    expect(row.is_primary_contact).toBe(true);
    expect(row.notifications_enabled).toBe(true);
  });
});

describe('diffFields', () => {
  it('reports no changes when nothing differs', () => {
    const guardian = makeGuardian();
    const row = fromRowOrThrow(toCells(guardian));
    expect(guardiansTab.diffFields(row, guardian)).toEqual([]);
  });

  it('names the changed field', () => {
    const guardian = makeGuardian();
    const row = fromRowOrThrow(toCells(guardian));
    expect(guardiansTab.diffFields({ ...row, occupation: 'Doctor' }, guardian)).toEqual([
      'occupation',
    ]);
  });
});
