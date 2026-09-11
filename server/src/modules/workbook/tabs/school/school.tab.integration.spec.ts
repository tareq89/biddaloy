import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { TestingModule } from '@nestjs/testing';
import { School } from '../../../schools/entities/school.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { schoolTab, type SchoolRow } from './school.tab';

/**
 * Integration tests for the `school` tab against a real Postgres database.
 *
 * The unit spec covers the pure mapping. What it cannot cover is the thing
 * that actually matters for a multi-tenant restore: that `upsert` writes to
 * one tenant's row and leaves every other tenant's alone. That needs a real
 * table with more than one school in it.
 */
describe('schoolTab (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;

  const TENANT_A = '11111111-1111-4111-8111-111111111111';
  const TENANT_B = '22222222-2222-4222-8222-222222222222';
  const SECRET = 'tenant-a-sms-key';

  beforeAll(async () => {
    module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
  });

  afterAll(async () => {
    await module?.close();
  });

  beforeEach(async () => {
    await schoolRepo.delete({ id: TENANT_A });
    await schoolRepo.delete({ id: TENANT_B });

    await schoolRepo.save(
      schoolRepo.create({
        id: TENANT_A,
        name: 'Tenant A School',
        slug: 'tenant-a-school',
        settings: {
          region: { timezone: 'Asia/Dhaka' },
          communications: { sms: { provider: 'mimsms', mimsms: { apiKey: SECRET } } },
        },
      }),
    );

    await schoolRepo.save(
      schoolRepo.create({
        id: TENANT_B,
        name: 'Tenant B School',
        slug: 'tenant-b-school',
        settings: { region: { timezone: 'Asia/Dhaka' } },
      }),
    );
  });

  function rowFor(overrides: Partial<SchoolRow> = {}): SchoolRow {
    return {
      id: TENANT_A,
      name: 'Tenant A Renamed',
      name_bn: null,
      address: null,
      phone: null,
      email: null,
      registration_id: null,
      settings: null,
      ...overrides,
    };
  }

  // Mandatory tenant-isolation scenario: a restore into tenant A must be
  // invisible to tenant B.
  it('updates only the addressed tenant and leaves the other unchanged', async () => {
    const existing = await schoolRepo.findOneByOrFail({ id: TENANT_A });

    await schoolTab.upsert(rowFor(), existing, TENANT_A, dataSource.manager);

    expect((await schoolRepo.findOneByOrFail({ id: TENANT_A })).name).toBe('Tenant A Renamed');
    expect((await schoolRepo.findOneByOrFail({ id: TENANT_B })).name).toBe('Tenant B School');
  });

  it('resolves the destination school from the tenant id when none is passed', async () => {
    await schoolTab.upsert(rowFor(), null, TENANT_A, dataSource.manager);

    expect((await schoolRepo.findOneByOrFail({ id: TENANT_A })).name).toBe('Tenant A Renamed');
    expect((await schoolRepo.findOneByOrFail({ id: TENANT_B })).name).toBe('Tenant B School');
  });

  // Business-critical: an imported workbook never carries secrets, because
  // export strips them. Restoring must therefore not wipe the credentials the
  // destination already had.
  it('keeps the stored secret when the imported settings do not mention it', async () => {
    const existing = await schoolRepo.findOneByOrFail({ id: TENANT_A });

    await schoolTab.upsert(
      rowFor({ settings: { region: { timezone: 'Asia/Kolkata' } } }),
      existing,
      TENANT_A,
      dataSource.manager,
    );

    const updated = await schoolRepo.findOneByOrFail({ id: TENANT_A });

    expect(updated.settings?.communications?.sms?.mimsms?.apiKey).toBe(SECRET);
    expect(updated.settings?.region?.timezone).toBe('Asia/Kolkata');
  });

  it('loads only the addressed tenant', async () => {
    const loaded = await schoolTab.load(TENANT_A, dataSource.manager);

    expect(loaded.map((s) => s.id)).toEqual([TENANT_A]);
  });

  it('never deletes the school', async () => {
    const existing = await schoolRepo.findOneByOrFail({ id: TENANT_A });

    await schoolTab.remove(existing, dataSource.manager);

    expect(await schoolRepo.findOneBy({ id: TENANT_A })).not.toBeNull();
  });
});
