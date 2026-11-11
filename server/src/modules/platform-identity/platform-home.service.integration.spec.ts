import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { School } from '../schools/entities/school.entity';
import { Student } from '../students/entities/student.entity';
import { TenantStatusService } from '../schools/tenant-status.service';
import { PlatformHomeService } from './platform-home.service';

describe('PlatformHomeService (integration)', () => {
  let ds: DataSource;
  let svc: PlatformHomeService;
  let oldPlatformId: string | undefined;
  const tag = `phs${process.pid}`;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, [
      PlatformHomeService,
      { provide: TenantStatusService, useValue: { configuredPlatformTenantId: () => oldPlatformId } },
    ]);
    ds = module.get<DataSource>(getDataSourceToken());
    svc = module.get(PlatformHomeService);
  });

  const cleanup = async () => {
    await ds.query(`UPDATE schools SET is_platform = false WHERE is_platform`);
    await ds.query(
      `DELETE FROM students WHERE tenant_id IN (SELECT id FROM schools WHERE slug LIKE $1)`,
      [`${tag}%`],
    );
    await ds.query(`DELETE FROM schools WHERE slug LIKE $1 OR slug = 'biddaloy-platform'`, [
      `${tag}%`,
    ]);
  };
  beforeEach(async () => {
    await cleanup();
    // A fresh service per test: the id cache must not leak between cases.
    svc = new PlatformHomeService(ds, { configuredPlatformTenantId: () => oldPlatformId } as never);
  });
  afterAll(cleanup);

  const makeOldSchool = async (withStudent: boolean) => {
    const school = await ds
      .getRepository(School)
      .save({ name: 'Old platform', slug: `${tag}-old` });
    oldPlatformId = school.id;
    if (withStudent) {
      // Any existing class section will do: only "this school has a student row" matters.
      const [section] = await ds.query(`SELECT id FROM class_sections LIMIT 1`);
      await ds.getRepository(Student).save({
        tenant_id: school.id,
        class_section_id: section.id,
        full_name: 'Real Student',
        registration_number: `${tag}-1`,
        roll_number: 900000 + (process.pid % 90000),
      } as never);
    }
    return school.id;
  };
  const flagged = () => ds.query(`SELECT id, slug FROM schools WHERE is_platform`);

  it('flags an old platform school that has no students', async () => {
    const oldId = await makeOldSchool(false);
    expect(await svc.ensure()).toBe(oldId);
    expect(await flagged()).toEqual([{ id: oldId, slug: `${tag}-old` }]);
  });

  it('creates biddaloy-platform when the old one has students, and leaves that school alone', async () => {
    const oldId = await makeOldSchool(true);
    const id = await svc.ensure();
    expect(id).not.toBe(oldId);
    const rows = await flagged();
    expect(rows).toEqual([{ id, slug: 'biddaloy-platform' }]);
    const [old] = await ds.query(`SELECT is_platform FROM schools WHERE id = $1`, [oldId]);
    expect(old.is_platform).toBe(false);
  });

  it('does not flag a slug-discovered school when no legacy platform id is configured', async () => {
    // Dev: platformTenantId() would find `default-school` by slug, but only the explicit id counts.
    const school = await ds.getRepository(School).save({ name: 'Dev school', slug: `${tag}-dev` });
    oldPlatformId = undefined;
    const id = await svc.ensure();
    expect(id).not.toBe(school.id);
    expect(await flagged()).toEqual([{ id, slug: 'biddaloy-platform' }]);
  });

  it('a second call changes nothing and never trips the unique index', async () => {
    await makeOldSchool(true);
    const first = await svc.ensure();
    const second = await svc.ensure();
    expect(second).toBe(first);
    expect(await flagged()).toHaveLength(1);
    expect(await svc.id()).toBe(first);
  });
});
