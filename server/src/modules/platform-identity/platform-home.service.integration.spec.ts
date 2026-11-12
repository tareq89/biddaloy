import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { PlatformHomeService } from './platform-home.service';

describe('PlatformHomeService (integration)', () => {
  let ds: DataSource;
  let svc: PlatformHomeService;
  const tag = `phs${process.pid}`;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    ds = module.get<DataSource>(getDataSourceToken());
  });

  const cleanup = async () => {
    await ds.query(`UPDATE schools SET is_platform = false WHERE is_platform`);
    await ds.query(`DELETE FROM schools WHERE slug LIKE $1 OR slug = 'biddaloy-platform'`, [
      `${tag}%`,
    ]);
  };
  beforeEach(async () => {
    await cleanup();
    // A fresh service per test: the id cache must not leak between cases.
    svc = new PlatformHomeService(ds);
  });
  afterAll(cleanup);

  const flagged = () => ds.query(`SELECT id, slug FROM schools WHERE is_platform`);

  it('creates biddaloy-platform when no row is flagged, and leaves other schools alone', async () => {
    // Epic 98 wave 5: no legacy platform id exists, so an ordinary school is never flagged.
    const other = await ds.getRepository(School).save({ name: 'Other', slug: `${tag}-other` });
    const id = await svc.ensure();
    expect(id).not.toBe(other.id);
    expect(await flagged()).toEqual([{ id, slug: 'biddaloy-platform' }]);
    const [row] = await ds.query(`SELECT is_platform FROM schools WHERE id = $1`, [other.id]);
    expect(row.is_platform).toBe(false);
  });

  it('reuses an already flagged row', async () => {
    const home = await ds
      .getRepository(School)
      .save({ name: 'Home', slug: `${tag}-home`, is_platform: true });
    expect(await svc.ensure()).toBe(home.id);
    expect(await flagged()).toEqual([{ id: home.id, slug: `${tag}-home` }]);
  });

  it('a second call changes nothing and never trips the unique index', async () => {
    const first = await svc.ensure();
    const second = await svc.ensure();
    expect(second).toBe(first);
    expect(await flagged()).toHaveLength(1);
    expect(await svc.id()).toBe(first);
  });
});
