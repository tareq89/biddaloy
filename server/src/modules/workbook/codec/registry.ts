import type { TabSpec } from './tab-spec';
import { schoolTabs } from '../tabs/school';
import { academicsTabs } from '../tabs/academics';
import { peopleTabs } from '../tabs/people';
import { feesTabs } from '../tabs/fees';

/**
 * Every tab name a backup workbook may contain, in apply order (epic 14.0
 * decision D2). A tab may only depend on tabs earlier in this list, which is
 * what makes a single forward pass a valid restore order.
 *
 * This list is the contract between lanes: it is fixed here in 14.1.1 so that
 * lanes 14.2-14.4 can each add their tabs without renegotiating ordering, and
 * so `readWorkbook` (14.1.3) can tell a known sheet from a stray one.
 */
export const EXPECTED_TABS = [
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
] as const;

export type ExpectedTabName = (typeof EXPECTED_TABS)[number];

/**
 * The live registry. Assembled from four per-group barrels rather than one
 * literal list so that each lane owns exactly one file and no two lanes ever
 * conflict in this one.
 */
export const ALL_TABS: readonly TabSpec<any, any>[] = [
  ...schoolTabs,
  ...academicsTabs,
  ...peopleTabs,
  ...feesTabs,
];

export class RegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RegistryError';
  }
}

/**
 * Fails loudly on a registry that could not produce a correct restore.
 *
 * Throws rather than returning a report: every caller (the registry spec, and
 * later the export/import services) treats an invalid registry as a
 * programming error that must stop the process, so a precise message is the
 * entire useful output.
 *
 * `ref` targets are checked against the tabs actually passed in, not against
 * `EXPECTED_TABS`. While the registry is only partly populated — the state for
 * all of waves 1 and 2 — a tab referencing a not-yet-landed tab would be a
 * genuine dangling reference at runtime, and validating against the passed
 * array is what catches it.
 */
export function assertRegistryValid(tabs: readonly TabSpec<any, any>[]): void {
  const seen = new Set<string>();
  const names = new Set(tabs.map((t) => t.name));
  const expected = new Set<string>(EXPECTED_TABS);

  // The registry must be a *subsequence* of EXPECTED_TABS, not merely a
  // subset of it. `dependsOn` alone cannot enforce the D2 order: two tabs
  // with no declared dependency between them could concatenate in either
  // order and still pass, which would make export sheet order drift from
  // the documented contract.
  let expectedCursor = -1;

  tabs.forEach((tab, index) => {
    if (seen.has(tab.name)) {
      throw new RegistryError(`Duplicate tab name "${tab.name}" at index ${index}.`);
    }
    seen.add(tab.name);

    if (!expected.has(tab.name)) {
      throw new RegistryError(
        `Tab "${tab.name}" is not one of the ${EXPECTED_TABS.length} names in EXPECTED_TABS. ` +
          `readWorkbook treats an unlisted sheet as stray and skips it, so this tab would ` +
          `silently vanish on restore.`,
      );
    }

    const position = EXPECTED_TABS.indexOf(tab.name as (typeof EXPECTED_TABS)[number]);
    if (position <= expectedCursor) {
      throw new RegistryError(
        `Tab "${tab.name}" is registered out of EXPECTED_TABS order (expected it before ` +
          `"${EXPECTED_TABS[expectedCursor]}").`,
      );
    }
    expectedCursor = position;

    for (const dependency of tab.dependsOn) {
      if (!names.has(dependency)) {
        throw new RegistryError(
          `Tab "${tab.name}" depends on "${dependency}", which is not registered.`,
        );
      }
      // `seen` holds only the tabs at a lower index, so membership here is
      // exactly "appears earlier in the array".
      if (!seen.has(dependency)) {
        throw new RegistryError(
          `Tab "${tab.name}" depends on "${dependency}", which must appear earlier in the registry.`,
        );
      }
    }

    const first = tab.columns[0];
    if (!first || first.key !== 'id' || first.type !== 'uuid') {
      throw new RegistryError(
        `Tab "${tab.name}" must declare { key: 'id', type: 'uuid' } as its first column.`,
      );
    }

    const columnKeys = new Set<string>();
    for (const column of tab.columns) {
      if (columnKeys.has(column.key)) {
        // Two ColumnSpecs with one key collapse to a single entry in the
        // `Record<string, string>` that fromRow receives, so the second
        // silently shadows the first on both export and import.
        throw new RegistryError(`Tab "${tab.name}" declares column "${column.key}" twice.`);
      }
      columnKeys.add(column.key);
    }

    // A tab with no natural key makes keyOf constant, which collapses its
    // whole KeyIndex to one entry and makes ref resolution and
    // deleteByAbsence match an arbitrary row.
    if (tab.naturalKey.length === 0) {
      throw new RegistryError(`Tab "${tab.name}" must declare at least one naturalKey column.`);
    }

    for (const key of tab.naturalKey) {
      if (!columnKeys.has(key)) {
        throw new RegistryError(
          `Tab "${tab.name}" has naturalKey entry "${key}" that is not one of its columns.`,
        );
      }
    }

    for (const column of tab.columns) {
      if (column.type === 'enum' && (!column.enumValues || column.enumValues.length === 0)) {
        // Without an allowed-value list the import validator has nothing to
        // check against, so a bad cell reaches the DB and fails the whole
        // restore instead of producing one per-row RowError.
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" is type "enum" but declares no enumValues.`,
        );
      }

      if (column.type !== 'ref' && column.type !== 'ref-list') continue;
      if (!column.ref) {
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" is type "${column.type}" but names no ref target.`,
        );
      }
      if (!names.has(column.ref)) {
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" references unknown tab "${column.ref}".`,
        );
      }
      // A ref target that isn't a declared dependency may be applied after
      // this tab, so its KeyIndex would not exist yet and every ctx.ref()
      // would return undefined — importing every row with a null parent.
      // Self-references (a parent class pointing at another class) are fine:
      // the tab is applied in one pass and can resolve within itself.
      if (column.ref !== tab.name && !tab.dependsOn.includes(column.ref)) {
        throw new RegistryError(
          `Tab "${tab.name}" column "${column.key}" references tab "${column.ref}", which must ` +
            `also be listed in its dependsOn.`,
        );
      }
    }
  });
}
