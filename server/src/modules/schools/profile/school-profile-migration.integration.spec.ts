import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DataSource, Repository } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { School } from '../entities/school.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';

/**
 * [15.5.1] Verifies the migration actually landed: `schools.name_bn`,
 * `schools.registration_id`, `schools.logo_key`, `invoices.issuer_snapshot`
 * and `payments.issuer_snapshot` all exist, are nullable, and a `School`
 * saves fine with the three new columns left null (no backfill — every
 * pre-existing school has none of this until an ADMIN fills it in).
 *
 * Runs against the already-migrated test database (no `synchronize` /
 * `dropSchema`) — see `server/CLAUDE.md`'s note on why new specs should
 * prefer that.
 */
describe('AddSchoolProfileAndIssuerSnapshot migration (integration)', () => {
  let dataSource: DataSource;
  let schoolRepo: Repository<School>;

  beforeAll(async () => {
    const module = await createTestModule(ALL_ENTITIES, []);
    dataSource = module.get(DataSource);
    schoolRepo = module.get<Repository<School>>(getRepositoryToken(School));
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  it('adds the three nullable columns to schools', async () => {
    const rows = await dataSource.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_name = 'schools' AND column_name IN ('name_bn', 'registration_id', 'logo_key')
       ORDER BY column_name`,
    );
    expect(rows).toEqual([
      { column_name: 'logo_key', is_nullable: 'YES' },
      { column_name: 'name_bn', is_nullable: 'YES' },
      { column_name: 'registration_id', is_nullable: 'YES' },
    ]);
  });

  it('adds a nullable issuer_snapshot jsonb column to invoices and payments', async () => {
    const rows = await dataSource.query(
      `SELECT table_name, column_name, is_nullable, data_type FROM information_schema.columns
       WHERE table_name IN ('invoices', 'payments') AND column_name = 'issuer_snapshot'
       ORDER BY table_name`,
    );
    expect(rows).toEqual([
      {
        table_name: 'invoices',
        column_name: 'issuer_snapshot',
        is_nullable: 'YES',
        data_type: 'jsonb',
      },
      {
        table_name: 'payments',
        column_name: 'issuer_snapshot',
        is_nullable: 'YES',
        data_type: 'jsonb',
      },
    ]);
  });

  it('saves a School with the new profile fields left null', async () => {
    const school = await schoolRepo.save(
      schoolRepo.create({
        name: `Test School ${randomUUID()}`,
        slug: `test-school-${randomUUID()}`,
      }),
    );

    expect(school.name_bn).toBeNull();
    expect(school.registration_id).toBeNull();
    expect(school.logo_key).toBeNull();

    const reloaded = await schoolRepo.findOneOrFail({ where: { id: school.id } });
    expect(reloaded.name_bn).toBeNull();
    expect(reloaded.registration_id).toBeNull();
    expect(reloaded.logo_key).toBeNull();
  });
});
