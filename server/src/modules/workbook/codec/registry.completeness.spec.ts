import { beforeAll, describe, expect, it } from 'vitest';
import { DataSource, type EntityTarget } from 'typeorm';
import { ALL_ENTITIES } from '@test/all-entities';
import { ALL_TABS } from './registry';
import { ENTITY_COVERAGE_EXEMPT } from './entity-coverage';

/**
 * The gate that stops a workbook tab quietly falling behind its entity.
 *
 * When someone adds a column to `School` — or to any entity a tab covers —
 * they must either export it or write down why they are not. This spec fails
 * until they do, naming the tab and the column, so "we forgot to back up the
 * new field" cannot ship silently.
 *
 * No database is involved. `DataSource.buildMetadatas()` resolves the same
 * entity metadata TypeORM uses at runtime from the decorators alone, so this
 * runs in the unit suite.
 */

/**
 * Columns every tab is allowed to omit without saying so:
 * - `id` is already `columns[0]` on every tab by contract
 * - `tenant_id` is supplied by the restore, never read from the file
 * - the timestamps are bookkeeping, and restoring them would falsify the
 *   destination's own audit history
 */
const UNIVERSAL = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at']);

describe('registry completeness', () => {
  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      entities: ALL_ENTITIES,
      synchronize: false,
    });
    // Builds metadata from the entity decorators without connecting.
    await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
  });

  it('covers at least the school tab', () => {
    // A guard on the gate itself: if ALL_TABS were empty the loop below would
    // pass vacuously and this spec would be worthless.
    expect(ALL_TABS.map((t) => t.name)).toContain('school');
  });

  it('every tab accounts for every column on its entity', () => {
    const problems: string[] = [];

    for (const tab of ALL_TABS) {
      const metadata = dataSource.getMetadata(tab.entity);
      const entityColumns = metadata.columns.map((c) => c.propertyName);

      const declared = new Set<string>([...tab.columns.map((c) => c.key), ...tab.excluded]);

      const missing = entityColumns.filter((name) => !declared.has(name) && !UNIVERSAL.has(name));

      if (missing.length > 0) {
        problems.push(
          `Tab "${tab.name}" does not account for ${metadata.name} column(s): ` +
            `${missing.join(', ')}. Add each one to the tab's \`columns\` to back it up, or to ` +
            `\`excluded\` with a // comment saying why it is deliberately not exported.`,
        );
      }
    }

    expect(problems).toEqual([]);
  });

  it('never lists a column in both columns and excluded', () => {
    for (const tab of ALL_TABS) {
      const keys = new Set(tab.columns.map((c) => c.key));
      const overlap = tab.excluded.filter((name) => keys.has(name));

      expect(overlap, `Tab "${tab.name}" both exports and excludes: ${overlap.join(', ')}`).toEqual(
        [],
      );
    }
  });

  it('never excludes a column the entity does not have', () => {
    for (const tab of ALL_TABS) {
      const entityColumns = new Set(
        dataSource.getMetadata(tab.entity).columns.map((c) => c.propertyName),
      );
      const stale = tab.excluded.filter((name) => !entityColumns.has(name));

      expect(
        stale,
        `Tab "${tab.name}" excludes column(s) that no longer exist: ${stale.join(', ')}`,
      ).toEqual([]);
    }
  });

  /**
   * The other direction of the gate (#835): a brand-new entity with no tab
   * passed silently before this test existed, because the checks above only
   * ever walk from a tab to its own entity — they never ask whether every
   * entity has a tab in the first place.
   */
  it('every entity has a tab or a documented coverage exemption', () => {
    const tabbedEntities = new Set(ALL_TABS.map((tab) => tab.entity));
    const problems: string[] = [];

    for (const entity of ALL_ENTITIES) {
      if (tabbedEntities.has(entity as EntityTarget<unknown>)) continue;
      if (ENTITY_COVERAGE_EXEMPT.has(entity as EntityTarget<unknown>)) continue;

      const name = dataSource.getMetadata(entity).name;
      problems.push(
        `Entity "${name}" has no workbook tab and no entry in ENTITY_COVERAGE_EXEMPT. ` +
          `Either add a tab for it, or add it to entity-coverage.ts with a reason.`,
      );
    }

    expect(problems).toEqual([]);
  });

  it('never exempts an entity that already has a tab', () => {
    const tabbedEntities = new Set(ALL_TABS.map((tab) => tab.entity));
    const staleExemptions = [...ENTITY_COVERAGE_EXEMPT.keys()]
      .filter((entity) => tabbedEntities.has(entity))
      .map((entity) => dataSource.getMetadata(entity).name);

    expect(
      staleExemptions,
      `ENTITY_COVERAGE_EXEMPT lists entities that already have a tab: ${staleExemptions.join(', ')}`,
    ).toEqual([]);
  });

  it('never exempts an entity that is not in ALL_ENTITIES', () => {
    const known = new Set(ALL_ENTITIES as EntityTarget<unknown>[]);
    const stale = [...ENTITY_COVERAGE_EXEMPT.keys()].filter((entity) => !known.has(entity));

    expect(
      stale,
      `ENTITY_COVERAGE_EXEMPT lists entities not in ALL_ENTITIES (stale): ${stale.length}`,
    ).toEqual([]);
  });
});
