import { describe, expect, it } from 'vitest';
import { ALL_TABS, EXPECTED_TABS, assertRegistryValid } from './registry';
import type { ColumnSpec, TabSpec } from './tab-spec';

const idColumn: ColumnSpec = { key: 'id', type: 'uuid', label: { en: 'ID', bn: 'আইডি' } };

const nameColumn: ColumnSpec = {
  key: 'name',
  type: 'string',
  required: true,
  label: { en: 'Name', bn: 'নাম' },
};

function refColumn(ref: string): ColumnSpec {
  return { key: 'class', type: 'ref', ref, label: { en: 'Class', bn: 'শ্রেণি' } };
}

/**
 * A minimal TabSpec whose behavioural methods are never called — every test
 * here exercises `assertRegistryValid`, which only reads the declarative
 * fields (name, dependsOn, columns, naturalKey).
 *
 * The defaults are deliberately *valid* (a real EXPECTED_TABS name, an
 * id:uuid first column, a non-empty naturalKey) so each test can introduce
 * exactly one defect and be sure that defect is what the assertion caught.
 */
function fakeTab(overrides: Partial<TabSpec<unknown, unknown>> = {}): TabSpec<unknown, unknown> {
  return {
    name: 'classes',
    entity: class Fake {},
    excluded: [],
    dependsOn: [],
    columns: [idColumn, nameColumn],
    naturalKey: ['name'],
    deleteByAbsence: false,
    load: () => Promise.resolve([]),
    toRow: () => ({}),
    fromRow: () => ({ row: {} }),
    keyOf: () => '',
    diffFields: () => [],
    upsert: () => Promise.resolve({}),
    remove: () => Promise.resolve(),
    ...overrides,
  };
}

describe('EXPECTED_TABS', () => {
  it('lists the 18 tab names in epic decision D2 order', () => {
    expect(EXPECTED_TABS).toEqual([
      'school',
      'academic_years',
      'classes',
      'sections',
      'subjects',
      'class_subjects',
      'holidays',
      'users',
      'teachers',
      'teacher_assignments',
      'guardians',
      'students',
      'enrollments',
      'fee_structures',
      'student_fees',
      'invoices',
      'payments',
      'payment_allocations',
    ]);
  });

  it('contains no duplicates', () => {
    expect(new Set(EXPECTED_TABS).size).toBe(EXPECTED_TABS.length);
  });
});

describe('ALL_TABS', () => {
  // Deliberately an invariant that survives the tab lanes populating their
  // barrels, rather than `toEqual([])` — otherwise every later lane would
  // have to edit this shared spec, which is the conflict the four-barrel
  // design exists to prevent.
  it('is valid', () => {
    expect(() => assertRegistryValid(ALL_TABS)).not.toThrow();
  });

  it('registers only names declared in EXPECTED_TABS', () => {
    for (const tab of ALL_TABS) {
      expect(EXPECTED_TABS).toContain(tab.name);
    }
  });
});

describe('assertRegistryValid', () => {
  it('accepts a valid registry', () => {
    const tabs = [
      fakeTab({ name: 'classes' }),
      fakeTab({
        name: 'students',
        dependsOn: ['classes'],
        columns: [idColumn, nameColumn, refColumn('classes')],
      }),
    ];

    expect(() => assertRegistryValid(tabs)).not.toThrow();
  });

  it('throws when a dependency appears later in the array', () => {
    // 'sections' depends on 'classes' but is listed first. Both names are in
    // EXPECTED_TABS order-wise reversed, so this also proves the dependsOn
    // check reports before the ordering check would.
    const tabs = [
      fakeTab({ name: 'sections', dependsOn: ['classes'] }),
      fakeTab({ name: 'classes' }),
    ];

    expect(() => assertRegistryValid(tabs)).toThrow(/must appear earlier/);
  });

  it('throws on a duplicate tab name', () => {
    const tabs = [fakeTab({ name: 'classes' }), fakeTab({ name: 'classes' })];

    expect(() => assertRegistryValid(tabs)).toThrow(/Duplicate tab name "classes"/);
  });

  // A tab whose ref target is missing from the registry entirely is caught by
  // the dependsOn check first, since a ref target must also be a dependency.
  it('throws when a ref column names a tab that is not registered at all', () => {
    const tabs = [
      fakeTab({
        name: 'students',
        dependsOn: ['classes'],
        columns: [idColumn, nameColumn, refColumn('classes')],
      }),
    ];

    expect(() => assertRegistryValid(tabs)).toThrow(
      /depends on "classes", which is not registered/,
    );
  });

  // A ref target that isn't a dependency is applied in an undefined order
  // relative to this tab, so every ctx.ref() would return undefined and every
  // row would import with a null parent.
  it('throws when a ref target is registered but not declared in dependsOn', () => {
    const tabs = [
      fakeTab({ name: 'classes' }),
      fakeTab({
        name: 'students',
        dependsOn: [],
        columns: [idColumn, nameColumn, refColumn('classes')],
      }),
    ];

    expect(() => assertRegistryValid(tabs)).toThrow(/also be listed in its dependsOn/);
  });

  it('allows a self-referencing ref column without a dependsOn entry', () => {
    const tabs = [
      fakeTab({ name: 'classes', columns: [idColumn, nameColumn, refColumn('classes')] }),
    ];

    expect(() => assertRegistryValid(tabs)).not.toThrow();
  });

  it('throws when the first column is not id:uuid', () => {
    const tabs = [fakeTab({ name: 'classes', columns: [nameColumn] })];

    expect(() => assertRegistryValid(tabs)).toThrow(/must declare \{ key: 'id', type: 'uuid' \}/);
  });

  it('throws when a naturalKey entry is not a column', () => {
    const tabs = [fakeTab({ name: 'classes', naturalKey: ['code'] })];

    expect(() => assertRegistryValid(tabs)).toThrow(
      /naturalKey entry "code" that is not one of its columns/,
    );
  });

  it('throws when naturalKey is empty', () => {
    const tabs = [fakeTab({ name: 'classes', naturalKey: [] })];

    expect(() => assertRegistryValid(tabs)).toThrow(/at least one naturalKey column/);
  });

  it('throws on a duplicate column key', () => {
    const tabs = [fakeTab({ name: 'classes', columns: [idColumn, nameColumn, nameColumn] })];

    expect(() => assertRegistryValid(tabs)).toThrow(/declares column "name" twice/);
  });

  it('throws when an enum column declares no enumValues', () => {
    const tabs = [
      fakeTab({
        name: 'classes',
        columns: [
          idColumn,
          nameColumn,
          { key: 'level', type: 'enum', label: { en: 'Level', bn: 'স্তর' } },
        ],
      }),
    ];

    expect(() => assertRegistryValid(tabs)).toThrow(/is type "enum" but declares no enumValues/);
  });

  it('throws when a tab name is not in EXPECTED_TABS', () => {
    const tabs = [fakeTab({ name: 'student' })];

    expect(() => assertRegistryValid(tabs)).toThrow(/is not one of the 18 names in EXPECTED_TABS/);
  });

  // dependsOn alone cannot catch this: 'subjects' and 'sections' have no
  // declared relationship, so only the EXPECTED_TABS subsequence check does.
  it('throws when two independent tabs are registered out of EXPECTED_TABS order', () => {
    const tabs = [fakeTab({ name: 'subjects' }), fakeTab({ name: 'sections' })];

    expect(() => assertRegistryValid(tabs)).toThrow(/out of EXPECTED_TABS order/);
  });
});
