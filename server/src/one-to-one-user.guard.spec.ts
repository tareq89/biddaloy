import { beforeAll, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '@test/all-entities';
import { User } from './modules/users/entities/user.entity';

/**
 * D17 guard 2: a school-scoped table must not be @OneToOne to User.
 *
 * A person can work at several schools. @OneToOne on a table with tenant_id
 * means "one row per person, platform-wide", so they could have it in only one
 * school. Use @ManyToOne plus a unique index on (tenant_id, user_id) instead.
 *
 * No database: `buildMetadatas()` resolves metadata from the decorators alone.
 * `ALL_ENTITIES` is hand-kept; #2161 makes it complete.
 */
// Empty since #2153 moved Teacher/Guardian/Student/StaffProfile to @ManyToOne.
const ALLOWED = new Map<string, string>();

describe('no @OneToOne(User) on tenant tables', () => {
  const found = new Set<string>();
  let inspected = 0;

  beforeAll(async () => {
    const dataSource = new DataSource({
      type: 'postgres',
      entities: ALL_ENTITIES,
      synchronize: false,
    });
    await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas();
    for (const metadata of dataSource.entityMetadatas) {
      if (!metadata.columns.some((c) => c.databaseName === 'tenant_id')) continue;
      inspected++;
      for (const relation of metadata.relations) {
        if (
          relation.relationType === 'one-to-one' &&
          relation.inverseEntityMetadata.target === User
        ) {
          found.add(`${metadata.name}.${relation.propertyName}`);
        }
      }
    }
  });

  it('has no new @OneToOne to User on a tenant table', () => {
    const bad = [...found].filter((k) => !ALLOWED.has(k));
    expect(
      bad,
      bad
        .map(
          (k) =>
            `${k} is @OneToOne to User on a school-scoped table. Use @ManyToOne plus a unique index on (tenant_id, user_id) - see #2153`,
        )
        .join('\n'),
    ).toEqual([]);
  });

  it('allow-list has no stale entries', () => {
    const stale = [...ALLOWED.keys()].filter((k) => !found.has(k));
    expect(stale, `remove it: #2153 landed (${stale.join(', ')})`).toEqual([]);
  });

  it('inspected at least one tenant entity', () => {
    expect(inspected).toBeGreaterThan(0);
  });
});
